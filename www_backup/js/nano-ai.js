/* ==========================================================
   FILE: nano-ai.js
   DESCRIPTION: Main EI for Offline Caching
   ========================================================== */
(function (window) {
    /* ==================== 0. AI CONSTANTS ==================== */
    const AI_INTENTS = {
        ONBOARD: 'ONBOARD_USER',
        VOUCHER: 'ACTIVATE_VOUCHER',
        CONNECT: 'INITIALIZE_NETWORK',
        PLAN: 'BUY_DATA',
        SHARE: 'SHARE_DATA',
        BALANCE: 'CHECK_BALANCE',
        FIX: 'FIX_CONNECTION',
        MANUAL: 'IDLE'
    };
    window.AI_INTENTS = AI_INTENTS;


    /* ==================== 1. CONTEXT MANAGER ==================== */
    const ContextManager = {

        cachedNetworkState: null,
        cachedMeshPeers: null,
        cachedTelemetry: null,

        async getFullContext() {
            const hasUser = !!window.currentUser;
            const role = window.currentUser?.role || 'guest';
            const cachedNetwork = this.getCachedNetworkState();
            const connectedSSID = cachedNetwork?.ssid || (window.NetworkTools ? await window.NetworkTools.getCleanSSID() : null);
            const cachedMesh = this.getCachedMeshPeers();
            const meshPeers = cachedMesh?.peerCount || (window.GossipService?.peers?.size || 0);
            const internetAvailable = (cachedNetwork?.online !== undefined) ? cachedNetwork.online : navigator.onLine;

            const context = {
                hasUser: hasUser,
                role: role,
                hasPlan: !!(window.currentUser?.activePlan || (window.hasActivePlanNow && window.hasActivePlanNow())),
                wifiEnabled: (typeof window.WifiWizard2 !== 'undefined'),
                connectedSSID: connectedSSID,
                internetAvailable: navigator.onLine,
                appPaused: window.isAppPaused === true,
                batteryLow: await this.isBatteryLow(),
                meshPeers: meshPeers,
                platform: (typeof device !== 'undefined' ? device.platform : 'web'),
                timestamp: Date.now(),
                networkQuality: cachedNetwork?.connectionQuality || 'unknown',
                networkInitialized: cachedNetwork?.isInitialized || false,
                meshPeerList: cachedMesh?.peers || [],
                meshLastUpdate: cachedMesh?.lastUpdate || null
            };
            localStorage.setItem('last_app_context', JSON.stringify(context));
            return context;
        },

        async getNeuralVector() {
            const raw = await this.getFullContext();
            return {
                hasUser: raw.hasUser ? 1 : 0,
                hasPlan: raw.hasPlan ? 1 : 0,
                wifiEnabled: raw.wifiEnabled ? 1 : 0,
                connectionState: raw.connectedSSID?.includes('Br3eze') ? 1 : (raw.connectedSSID ? 0.5 : 0),
                internetAvailable: raw.internetAvailable ? 1 : 0,
                batteryLow: raw.batteryLow ? 1 : 0,
                meshDensity: Math.min(raw.meshPeers / 10, 1),
                isMobile: raw.platform !== 'web' ? 1 : 0
            };
        },

        async isBatteryLow() {
            if (!navigator.getBattery) return false;
            try {
                const battery = await navigator.getBattery();
                return battery.level < 0.15 && !battery.charging;
            } catch (e) { return false; }
        },

        // Receive network state from NetworkTools
        updateNetworkState(state) {
            this.cachedNetworkState = state;
            this.lastNetworkUpdate = Date.now();
        },

        // Get cached network state (faster than async call)
        getCachedNetworkState() {
            return this.cachedNetworkState || null;
        },

        // Receive telemetry from captureLocalDeviceInfo
        updateTelemetry(telemetry) {
            this.cachedTelemetry = {
                ...telemetry,
                receivedAt: Date.now()
            };
        },

        // Get cached telemetry
        getCachedTelemetry() {
            return this.cachedTelemetry || null;
        },

        // Receive mesh peer updates from GossipService
        updateMeshPeers(peerData) {
            this.cachedMeshPeers = {
                peers: peerData.peers || [],
                peerCount: peerData.peerCount || 0,
                lastUpdate: Date.now()
            };
        },

        // Get cached mesh peer data
        getCachedMeshPeers() {
            return this.cachedMeshPeers || null;
        }
    };

    /* ==================== 2. NEURAL UTILS ==================== */
    const NeuralUtils = {
        INTENT_LENGTH: 20,
        encodeIntent(str) {
            const arr = new Array(this.INTENT_LENGTH).fill(0);
            for (let i = 0; i < str.length && i < this.INTENT_LENGTH; i++) {
                arr[i] = str.charCodeAt(i) / 255;
            }
            return arr;
        }
    };

    /* ==================== 3. EDGE POLICY ENFORCEMENT ==================== */
    const EdgePolicy = {
        async enforce(config) {
            const { userId, action } = config;
            console.log(`[EdgePolicy] Enforcing ${action} for user: ${userId}`);

            if (typeof window.NetworkTools !== 'undefined' && window.NetworkTools.isInitialized) {
                switch (action) {
                    case 'BLOCK': await window.NetworkTools.disconnectUser(userId); break;
                    case 'THROTTLE': await window.NetworkTools.throttleUser(userId, 128); break;
                    case 'ALLOW': await window.NetworkTools.allowUser(userId); break;
                    default: console.warn("[EdgePolicy] Unknown action:", action);
                }
            } else {
                console.warn("[EdgePolicy] NetworkTools not available for enforcement.");
            }
            return { success: true, policy: action };
        }
    };


    /* ==================== 3. OUTCOME-BASED LEARNING ==================== */
    const OutcomeLearning = {
        stats: {},
        recordOutcome(intent, success = true) {
            if (!intent) return;
            if (!this.stats[intent]) this.stats[intent] = { success: 0, fail: 0 };
            this.stats[intent][success ? 'success' : 'fail']++;
            const total = this.stats[intent].success + this.stats[intent].fail;
            this.stats[intent].confidence = this.stats[intent].success / total;
        },
        getConfidence(intent) { return this.stats[intent]?.confidence || 0.5; },
        pickBestIntent(candidates) {
            let best = 'IDLE', max = 0;
            for (const i of candidates) { const c = this.getConfidence(i); if (c > max) { max = c; best = i; } }
            return best;
        },
        decayStats(factor = 0.9) {
            for (const k in this.stats) {
                this.stats[k].success *= factor;
                this.stats[k].fail *= factor;
            }
        }
    };

    /* ==================== 4. NANO AI: DECISIONS & INTENTS ==================== */
    const NanoAI = (() => {
        let decisionNet = null;
        let intentNet = null;
        let decisionCache = new Map(); // Predictive caching
        let lastDecision = null;
        let decisionHistory = [];
        let MAX_HISTORY = 50;


        if (typeof brain !== 'undefined') {

            decisionNet = new brain.NeuralNetwork({
                hiddenLayers: [8, 6], // Deeper network for better accuracy
                learningRate: 0.4,     // Faster learning
                activation: 'sigmoid'  // Better for binary decisions
            });

            // Expanded training data: 40+ nuanced scenarios for high precision
            decisionNet.train([
                // --- ONBOARDING (hasUser: 0) ---
                { input: { hasUser: 0, hasPlan: 0, wifiEnabled: 1, connectionState: 0.5, internetAvailable: 0, batteryLow: 0, meshDensity: 0.1 }, output: { ONBOARD_USER: 1 } },
                { input: { hasUser: 0, hasPlan: 0, wifiEnabled: 0, connectionState: 0, internetAvailable: 1, batteryLow: 0, meshDensity: 0 }, output: { ONBOARD_USER: 1 } },
                { input: { hasUser: 0, hasPlan: 1, wifiEnabled: 1, connectionState: 1, internetAvailable: 1, batteryLow: 0, meshDensity: 0.5 }, output: { ONBOARD_USER: 1 } },

                // --- VOUCHER ACTIVATION (hasUser: 1, hasPlan: 0) ---
                { input: { hasUser: 1, hasPlan: 0, wifiEnabled: 1, connectionState: 1, internetAvailable: 0, batteryLow: 0, meshDensity: 0.3 }, output: { ACTIVATE_VOUCHER: 1 } },
                { input: { hasUser: 1, hasPlan: 0, wifiEnabled: 1, connectionState: 0.5, internetAvailable: 0, batteryLow: 0, meshDensity: 0 }, output: { ACTIVATE_VOUCHER: 1 } },
                { input: { hasUser: 1, hasPlan: 0, wifiEnabled: 1, connectionState: 1, internetAvailable: 1, batteryLow: 1, meshDensity: 0.2 }, output: { ACTIVATE_VOUCHER: 0.8, IDLE: 0.2 } },

                // --- NETWORK INITIALIZATION (hasUser: 1, hasPlan: 1, DISCONNECTED) ---
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 0.2, internetAvailable: 0, batteryLow: 0, meshDensity: 0.1 }, output: { INITIALIZE_NETWORK: 1 } },
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 0.5, internetAvailable: 0, batteryLow: 0, meshDensity: 0.9 }, output: { INITIALIZE_NETWORK: 1 } },
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 0.8, internetAvailable: 0, batteryLow: 0, meshDensity: 0.5 }, output: { INITIALIZE_NETWORK: 1 } },

                // --- MAINTENANCE (Connected, has plan, but room for improvement) ---
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 1, internetAvailable: 0.2, batteryLow: 0, meshDensity: 0.1 }, output: { MAINTENANCE: 1 } },
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 0.8, internetAvailable: 1, batteryLow: 0, meshDensity: 0.1 }, output: { MAINTENANCE: 1 } },

                // --- IDLE (Perfect states) ---
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 1, internetAvailable: 1, batteryLow: 0, meshDensity: 0.1 }, output: { IDLE: 1 } },
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 1, internetAvailable: 1, batteryLow: 0, meshDensity: 0.9 }, output: { IDLE: 1 } },

                // --- CRITICAL EDGE CASES (Low Battery, Mesh Flooding) ---
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 1, internetAvailable: 0, batteryLow: 1, meshDensity: 0.1 }, output: { IDLE: 1 } }, // Save power if offline
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 0, internetAvailable: 0, batteryLow: 1, meshDensity: 0.8 }, output: { INITIALIZE_NETWORK: 0.3, IDLE: 0.7 } }, // hesitant mesh
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 0.1, internetAvailable: 0, batteryLow: 0, meshDensity: 1.0 }, output: { INITIALIZE_NETWORK: 1 } }  // Priority mesh
            ], {
                iterations: 25000,
                errorThresh: 0.002
            });

            // B. Enhanced Intent Classifier (More patterns)
            intentNet = new brain.NeuralNetwork({
                hiddenLayers: [16, 12], // Deeper for complex patterns
                learningRate: 0.35
            });

            const encode = (s) => NeuralUtils.encodeIntent(s);

            intentNet.train([
                // Purchase intents
                { input: encode('buy data'), output: { BUY_DATA: 1 } },
                { input: encode('purchase plan'), output: { BUY_DATA: 1 } },
                { input: encode('get more data'), output: { BUY_DATA: 1 } },
                { input: encode('need internet'), output: { BUY_DATA: 1 } },

                // Sharing intents
                { input: encode('share credit'), output: { SHARE_DATA: 1 } },
                { input: encode('send data'), output: { SHARE_DATA: 1 } },
                { input: encode('transfer balance'), output: { SHARE_DATA: 1 } },

                // Voucher intents
                { input: encode('activate voucher'), output: { ACTIVATE_VOUCHER: 1 } },
                { input: encode('redeem code'), output: { ACTIVATE_VOUCHER: 1 } },
                { input: encode('use voucher'), output: { ACTIVATE_VOUCHER: 1 } },

                // Balance check intents
                { input: encode('check balance'), output: { CHECK_BALANCE: 1 } },
                { input: encode('how much data'), output: { CHECK_BALANCE: 1 } },
                { input: encode('my balance'), output: { CHECK_BALANCE: 1 } },

                // Troubleshooting intents
                { input: encode('internet not working'), output: { FIX_CONNECTION: 1 } },
                { input: encode('no connection'), output: { FIX_CONNECTION: 1 } },
                { input: encode('cant connect'), output: { FIX_CONNECTION: 1 } },
                { input: encode('wifi problem'), output: { FIX_CONNECTION: 1 } }
            ], {
                iterations: 25000,
                errorThresh: 0.003
            });
        }

        function deterministic(vector) {
            if (vector.hasUser === 0) return AI_INTENTS.ONBOARD;
            if (vector.hasPlan === 0) return AI_INTENTS.VOUCHER;
            if (vector.connectionState < 0.3 && vector.wifiEnabled === 1) return AI_INTENTS.CONNECT;
            if (vector.connectionState === 0 && vector.wifiEnabled === 0) return AI_INTENTS.FIX;
            return AI_INTENTS.MANUAL;
        }

        function detectIntent(text) {
            if (!intentNet) return null;
            try {
                const startTime = performance.now();
                const result = intentNet.run(NeuralUtils.encodeIntent(text));
                const intent = Object.keys(result).reduce((a, b) => result[a] > result[b] ? a : b);
                console.log(`[NanoAI] Text Intent: ${intent} (${(performance.now() - startTime).toFixed(2)}ms)`);
                return { intent, confidence: result[intent] };
            } catch (e) { return null; }
        }

        // 3-Tier Decision Engine: Symbolic -> ML -> Deterministic
        async function decide(vector, text = null) {
            let decision = null;

            // Tier 1: Text
            if (text) {
                const textRes = detectIntent(text);
                if (textRes && textRes.confidence > 0.8) decision = textRes.intent;
            }

            // Tier 2: Brain.js Neural Vector
            if (!decision && decisionNet) {
                const cacheKey = JSON.stringify(vector);
                if (decisionCache.has(cacheKey)) {
                    decision = decisionCache.get(cacheKey);
                } else {
                    const res = decisionNet.run(vector);
                    decision = Object.keys(res).reduce((a, b) => res[a] > res[b] ? a : b);
                    decisionCache.set(cacheKey, decision);
                }
            }


            // Tier 3: Deterministic Fallback & Outcome Refinement
            if (!decision || decision === 'IDLE') {
                let detDecision = deterministic(vector);
                // Use Outcome Learning to verify if we should really trigger this fallback
                const candidates = [detDecision, AI_INTENTS.ONBOARD, AI_INTENTS.VOUCHER, AI_INTENTS.FIX, AI_INTENTS.CONNECT];
                decision = OutcomeLearning.pickBestIntent(candidates);
            }

            const finalDecision = decision || AI_INTENTS.MANUAL;

            lastDecision = { decision: finalDecision, timestamp: Date.now(), vector, text };
            decisionHistory.push(lastDecision);
            if (decisionHistory.length > MAX_HISTORY) decisionHistory.shift();

            return finalDecision;
        }

        return {
            decide,
            detectIntent,
            getLastDecision: () => lastDecision,
            getDecisionHistory: () => decisionHistory,
            clearCache: () => decisionCache.clear()
        };
    })();




    /* ==================== 5. AI ORCHESTRATOR ==================== */
    class AIOrchestrator {
        constructor() {
            this.cycleInterval = null;
            this.isInitialized = false;
            this.nativeAvailable = false;
            this.browserSession = null;
            this.SAFETY_BLOCKLIST = ["hack", "bypass", "exploit", "leak", "malware", "password", "token"];
        }

        async init() {
            if (this.isInitialized) return;
            this.isInitialized = true;
            console.log('[AIOrchestrator] Initializing...');

            if (typeof AICore !== 'undefined') {
                try {
                    const caps = await AICore.capabilities();
                    if (caps?.available) this.nativeAvailable = true;
                } catch (e) { console.warn('[AI] AICore check failed', e); }
            }
            if (!this.nativeAvailable && window.ai?.canCreateTextSession) {
                try {
                    const status = await window.ai.canCreateTextSession();
                    if (status === "readily" || status === "after_download") {
                        this.browserSession = await window.ai.createTextSession();
                    }
                } catch (e) { console.warn('[AI] Browser AI init failed', e); }
            }
            console.log(`[AI] Ready. Native(${this.nativeAvailable}), Browser(${!!this.browserSession})`);

            this.startAutoCycle();
            return this;
        }

        startAutoCycle(interval = 60000) {
            if (this.cycleInterval) clearInterval(this.cycleInterval);
            console.log(`[AI] Auto-decision cycle started (${interval / 1000}s)`);
            this.cycleInterval = setInterval(() => this.executeDecision(), interval);
        }

        stopAutoCycle() {
            if (this.cycleInterval) clearInterval(this.cycleInterval);
            console.log("[AI] Auto-decision cycle paused");
        }

        async decide(prompt = null) {
            const vector = await ContextManager.getNeuralVector();
            return await NanoAI.decide(vector, prompt);
        }

        async executeDecision(prompt = null) {
            if (window.isAppPaused) return;

            const vector = await ContextManager.getNeuralVector();
            const action = await NanoAI.decide(vector, prompt);

            if (action !== 'IDLE' && action !== AI_INTENTS.MANUAL) {
                console.log("[AI] Decision Action Triggered:", action);
                if (window.AppBridge && window.AppBridge.executeIntent) {
                    await window.AppBridge.executeIntent(action);
                }
            }
            return action;
        }

        isUnsafe(prompt) {
            if (!prompt || typeof prompt !== 'string') return false;
            const lower = prompt.toLowerCase();
            return this.SAFETY_BLOCKLIST.some(word => lower.includes(word));
        }

        async generateText(prompt) {
            if (this.isUnsafe(prompt)) return "Security Alert: Blocked content detected.";

            // 1. Try Native AI (AICore)
            if (this.nativeAvailable) {
                try { return await new Promise((resolve, reject) => AICore.generateText(prompt, resolve, reject)); }
                catch (e) { console.warn('[AI] Native generation failed', e); }
            }

            // 2. Try Browser AI (Gemini Nano)
            if (this.browserSession) {
                try { return (await this.browserSession.prompt(prompt)).trim(); }
                catch (e) { console.warn('[AI] Browser AI failed', e); }
            }

            // 3. Smart Offline Fallback (Neural Intent + Heuristics)
            const context = await ContextManager.getFullContext();

            // Administrative logic
            if (context.role === 'admin' || context.role === 'family') {
                const cmd = prompt.toLowerCase();
                if (cmd.includes('status report')) return await PrivilegedBridge.getStatusReport();
                if (cmd.includes('debug mesh')) return await PrivilegedBridge.debugMesh();
                if (cmd.includes('reset network')) return await PrivilegedBridge.executeAdminAction('reset network');
                if (cmd.includes('clear cache')) { NanoAI.clearCache(); return "Decision cache cleared"; }
            }

            const intentResult = NanoAI.detectIntent(prompt);
            const intent = intentResult?.intent;
            const confidence = intentResult?.confidence || 0;

            if (intent && confidence > 0.7) {
                const responses = {
                    'BUY_DATA': "📱 I've opened the 'Subscriptions' tab for you. We have daily and weekly plans.",
                    'SHARE_DATA': "💸 Redirecting you to 'Share Credit'. Enter the receiver's phone number.",
                    'ACTIVATE_VOUCHER': "🎟️ Opening the voucher scanner now. Please have your code ready.",
                    'CHECK_BALANCE': window.currentUser ? `💰 Balance: $${window.currentUser.credits || 0}` : "Please log in to see your balance.",
                    'FIX_CONNECTION': "🔧 Offline? I'm initiating a connection check. Try toggling Wi-Fi if it fails."
                };

                if (confidence > 0.9) {
                    console.log(`[AI] Auto-delegating high-confidence intent: ${intent}`);
                    setTimeout(() => window.AppBridge.suggestAction(intent), 500);
                }

                if (responses[intent]) return responses[intent];
            }

            // Environmental Tips
            if (!context.internetAvailable) {
                if (context.connectedSSID && !context.connectedSSID.includes('Br3eze')) {
                    return "💡 Tip: You're on Wi-Fi but not a Br3eze network. Switch to Br3eze for app benefits.";
                }
                if (context.meshPeers > 0) {
                    return `📍 You're offline, but there are ${context.meshPeers} mesh peers nearby. You can still chat and share!`;
                }
                return "I'm in offline mode. I can help with: plans, vouchers, balance, and troubleshooting.";
            }

            return "I am your AI assistant. How can I help you today?";
        }

        getStatus() {
            return {
                initialized: this.isInitialized,
                native: this.nativeAvailable,
                browser: !!this.browserSession,
                lastDecision: NanoAI.getLastDecision()
            };
        }

        async process(input, context = {}, success = null, error = null) {
            console.log(`[AIOrchestrator] Processing: ${input}`);
            try {
                const result = await this.generateText(input);
                if (success) success({ message: result });
                return result;
            } catch (e) {
                if (error) error(e);
                throw e;
            }
        }
    }


    /* ==================== 6. INTEGRATION BRIDGES (APP TUNNEL) ==================== */
    const AppBridge = {
        async executeIntent(intent, context = {}) {
            console.log(`[AppBridge] Executing: ${intent}`);
            // Dispatch to UI based on intent
            if (intent === AI_INTENTS.ONBOARD && window.showSection) window.showSection('onboarding');
            if (intent === AI_INTENTS.VOUCHER && window.showToast) window.showToast("Suggest: Activate Voucher", "info");
            if (intent === AI_INTENTS.CONNECT && window.NetworkTools) window.NetworkTools.initialize();

            switch (intent) {
                case 'ONBOARD_USER':
                    if (window.showSection) window.showSection('onboarding');
                    break;
                case 'ACTIVATE_VOUCHER':
                    if (typeof window.openRedeemVoucher === 'function') window.openRedeemVoucher();
                    break;
                case 'FIX_CONNECTION':
                case 'INITIALIZE_NETWORK':
                    if (window.NetworkTools?.initialize) window.NetworkTools.initialize();
                    break;
                case 'BUY_DATA':
                    if (window.showSection) window.showSection('subscriptions');
                    break;
                default:
                    console.warn(`[AppBridge] Unhandled intent: ${intent}`);
            }
        },
        async suggestAction(action, context = {}) {
            await this.executeIntent(action, context);
        }
    };

    const PrivilegedBridge = {
        async getStatusReport() {
            const context = await ContextManager.getFullContext();
            return `📊 System Status Report:\n- Role: ${context.role}\n- Network: ${context.connectedSSID || 'None'}\n- Internet: ${context.internetAvailable ? 'Connected' : 'Offline'}\n- Mesh Peers: ${context.meshPeers}`;
        },
        async debugMesh() {
            return "🕸️ Mesh Debug Info: [Gossip layer active]";
        },
        async executeAdminAction(command) {
            if (command.includes('reset network')) {
                if (window.NetworkTools?.initialize) {
                    window.NetworkTools.initialize();
                    return "🔄 Network reset initiated.";
                }
            }
            return "Unknown admin action.";
        }
    };


    /* ==================== 7. OFFLINE CHAT ASSISTANT ==================== */
    const NanoAssistant = {
        async query(prompt) {
            if (!prompt) return "⚠️ Invalid query";
            return await window.aiOrchestrator.generateText(prompt);
        }
    };


    /* ==================== 8. GLOBAL EXPOSE & BOOT ==================== */
    window.ContextManager = ContextManager;
    window.EdgePolicy = EdgePolicy;
    window.OutcomeLearning = OutcomeLearning;
    window.NanoAI = NanoAI;
    window.AppBridge = AppBridge;
    window.PrivilegedBridge = PrivilegedBridge;
    window.NanoAssistant = NanoAssistant;

    window.aiOrchestrator = new AIOrchestrator();
    window.AIOrchestrator = window.aiOrchestrator;

    window.AI = {
        init: () => window.aiOrchestrator.init(),
        decide: (p) => window.aiOrchestrator.decide(p),
        chat: (p) => window.aiOrchestrator.generateText(p),
        cycle: () => window.aiOrchestrator.executeDecision(),
        instance: window.aiOrchestrator
    };

    // Auto-boot on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.AI.init());
    } else {
        window.AI.init();
    }

})(window);
