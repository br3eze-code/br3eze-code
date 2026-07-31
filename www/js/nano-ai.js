/* ==========================================================
   FILE: nano-ai.js
   DESCRIPTION: Main AI Engine for Offline Caching & Decisions
   ENHANCED: Added Neural Pulse & Conversational Intelligence
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
        MANUAL: 'IDLE',
        IDLE: 'IDLE'
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
                timestamp: Date.now()
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

        updateNetworkState(state) { this.cachedNetworkState = state; },
        getCachedNetworkState() { return this.cachedNetworkState; },
        updateTelemetry(telemetry) { this.cachedTelemetry = telemetry; },
        updateMeshPeers(peerData) { this.cachedMeshPeers = peerData; },
        getCachedMeshPeers() { return this.cachedMeshPeers; }
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

    /* ==================== 3. OUTCOME-BASED LEARNING ==================== */
    const OutcomeLearning = {
        stats: {},
        recordOutcome(intent, success = true) {
            if (!intent) return;
            if (!this.stats[intent]) this.stats[intent] = { success: 0, fail: 0 };
            this.stats[intent][success ? 'success' : 'fail']++;
        },
        getConfidence(intent) { return this.stats[intent] ? (this.stats[intent].success / (this.stats[intent].success + this.stats[intent].fail + 1)) : 0.5; },
        pickBestIntent(candidates) {
            let best = 'IDLE', max = -1;
            for (const i of candidates) { const c = this.getConfidence(i); if (c > max) { max = c; best = i; } }
            return best;
        }
    };

    /* ==================== 4. NANO AI ENGINE ==================== */
    const NanoAI = (() => {
        let decisionNet = null;
        let intentNet = null;
        let lastDecision = null;

        function initNets() {
            if (typeof brain === 'undefined') return;

            decisionNet = new brain.NeuralNetwork({ hiddenLayers: [8, 6] });
            decisionNet.train([
                { input: { hasUser: 0, hasPlan: 0, wifiEnabled: 1, connectionState: 0.5, internetAvailable: 0, batteryLow: 0, meshDensity: 0.1 }, output: { ONBOARD_USER: 1 } },
                { input: { hasUser: 1, hasPlan: 0, wifiEnabled: 1, connectionState: 1, internetAvailable: 0, batteryLow: 0, meshDensity: 0.3 }, output: { ACTIVATE_VOUCHER: 1 } },
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 0.2, internetAvailable: 0, batteryLow: 0, meshDensity: 0.1 }, output: { INITIALIZE_NETWORK: 1 } },
                { input: { hasUser: 1, hasPlan: 1, wifiEnabled: 1, connectionState: 1, internetAvailable: 1, batteryLow: 0, meshDensity: 0.1 }, output: { IDLE: 1 } }
            ]);

            intentNet = new brain.NeuralNetwork({ hiddenLayers: [16, 12] });
            const encode = (s) => NeuralUtils.encodeIntent(s);
            intentNet.train([
                { input: encode('buy data'), output: { BUY_DATA: 1 } },
                { input: encode('purchase plan'), output: { BUY_DATA: 1 } },
                { input: encode('share credit'), output: { SHARE_DATA: 1 } },
                { input: encode('activate voucher'), output: { ACTIVATE_VOUCHER: 1 } },
                { input: encode('redeem code'), output: { ACTIVATE_VOUCHER: 1 } },
                { input: encode('check balance'), output: { CHECK_BALANCE: 1 } },
                { input: encode('how much data'), output: { CHECK_BALANCE: 1 } },
                { input: encode('internet not working'), output: { FIX_CONNECTION: 1 } },
                { input: encode('no connection'), output: { FIX_CONNECTION: 1 } }
            ]);
        }

        function detectIntent(text) {
            if (!intentNet) return null;
            try {
                const result = intentNet.run(NeuralUtils.encodeIntent(text));
                const intent = Object.keys(result).reduce((a, b) => result[a] > result[b] ? a : b);
                return { intent, confidence: result[intent] };
            } catch (e) { return null; }
        }

        async function decide(vector, text = null) {
            let decision = null;
            if (text) {
                const textRes = detectIntent(text);
                if (textRes && textRes.confidence > 0.8) decision = textRes.intent;
            }
            if (!decision && decisionNet) {
                const res = decisionNet.run(vector);
                decision = Object.keys(res).reduce((a, b) => res[a] > res[b] ? a : b);
            }
            if (!decision || decision === 'IDLE') {
                decision = (vector.hasUser === 0) ? AI_INTENTS.ONBOARD :
                    (vector.hasPlan === 0) ? AI_INTENTS.VOUCHER :
                        (vector.connectionState < 0.3) ? AI_INTENTS.CONNECT : AI_INTENTS.IDLE;
            }
            lastDecision = decision;
            return decision;
        }

        // --- NEW: AI HEALTH PULSE (AgentOS Enhanced) ---
        async function monitorPulse() {
            if (!window.RouterBridge || !window.currentUser) return;
            
            setInterval(async () => {
                try {
                    const health = await window.RouterBridge.getHealthReport().catch(() => null);
                    const pulseEl = document.getElementById('neural-pulse');
                    const statusEl = document.getElementById('pulse-status');
                    
                    if (!pulseEl || !statusEl) return;

                    // Neural logic: Combine CPU and Active Users for "Load"
                    const load = health ? (health.cpu / 100) : 0.1;
                    const userCount = health ? health.users : 0;
                    
                    pulseEl.className = 'neural-pulse';
                    if (load > 0.8 || userCount > 50) {
                        pulseEl.classList.add('pulse-critical');
                        statusEl.innerText = `Neural Overload: ${load*100}% CPU | ${userCount} Users`;
                        statusEl.style.color = 'var(--color-danger-text)';
                    } else if (load > 0.5 || userCount > 20) {
                        pulseEl.classList.add('pulse-warning');
                        statusEl.innerText = `Neural Stress: ${load*100}% CPU | ${userCount} Users`;
                        statusEl.style.color = '#ffcc00';
                    } else {
                        pulseEl.classList.add('pulse-ok');
                        statusEl.innerText = `Neural Link: Optimal (${userCount} Connected)`;
                        statusEl.style.color = 'var(--color-success-text)';
                    }
                } catch (e) { }
            }, 8000);
        }

        // --- NEW: CONVERSATIONAL COMMANDS ---
        async function processCommand(text) {
            if (!text) return;
            const input = text.toLowerCase();
            const inputEl = document.getElementById('ai-input');
            if (inputEl) inputEl.value = '';

            console.log(`🤖 [NanoAI] Processing Command: "${text}"`);
            
            if (input.includes('online') || input.includes('status') || input.includes('who')) {
                if (window.showSection) window.showSection('roaming');
            } else if (input.includes('plan') || input.includes('buy') || input.includes('data')) {
                if (window.showSection) window.showSection('subscriptions');
            } else if (input.includes('fix') || input.includes('connect')) {
                if (window.NetworkTools) window.NetworkTools.initialize();
            } else if (input.includes('balance') || input.includes('credit') || input.includes('money')) {
                if (window.updateDashboard) window.updateDashboard();
            } else {
                const vector = await ContextManager.getNeuralVector();
                const decision = await decide(vector, text);
                await AppBridge.executeIntent(decision);
            }
        }

        initNets();
        return { 
            decide, 
            detectIntent, 
            monitorPulse, 
            processCommand,
            getLastDecision: () => lastDecision 
        };
    })();

    /* ==================== 5. INTEGRATION BRIDGES ==================== */
    const AppBridge = {
        lastIntent: null,
        lastIntentTime: 0,
        COOLDOWN: 5000, 

        async executeIntent(intent, context = {}) {
            const now = Date.now();
            if (intent === this.lastIntent && (now - this.lastIntentTime) < this.COOLDOWN) {
                return;
            }
            this.lastIntent = intent;
            this.lastIntentTime = now;

            console.log(`[AppBridge] Executing: ${intent}`);
            switch (intent) {
                case 'ONBOARD_USER': if (window.showSection) window.showSection('onboarding'); break;
                case 'ACTIVATE_VOUCHER': if (window.showSection) window.showSection('vouchers'); break;
                case 'INITIALIZE_NETWORK': if (window.NetworkTools) window.NetworkTools.initialize(); break;
                case 'BUY_DATA': if (window.showSection) window.showSection('plans'); break;
                case 'SHARE_DATA': if (window.showSection) window.showSection('share'); break;
                default: if (window.showSection) window.showSection('dashboard');
            }
        }
    };

    const PrivilegedBridge = {
        async getStatusReport() {
            const context = await ContextManager.getFullContext();
            return `📊 System Status Report:\n- Role: ${context.role}\n- Network: ${context.connectedSSID || 'None'}\n- Internet: ${context.internetAvailable ? 'Connected' : 'Offline'}`;
        }
    };

    /* ==================== 6. AI ORCHESTRATOR ==================== */
    class AIOrchestrator {
        constructor() {
            this.cycleInterval = null;
            this.nativeAvailable = false;
            this.browserSession = null;
        }

        async init() {
            if (typeof AICore !== 'undefined') {
                try {
                    const caps = await AICore.capabilities();
                    if (caps?.available) this.nativeAvailable = true;
                } catch (e) { }
            }
            if (!this.nativeAvailable && window.ai?.createTextSession) {
                try {
                    this.browserSession = await window.ai.createTextSession();
                } catch (e) { }
            }
            console.log(`[AI Orchestrator] Ready. Native: ${this.nativeAvailable}, Browser: ${!!this.browserSession}`);
            
            // Start Pulse monitoring
            NanoAI.monitorPulse();
            
            this.startAutoCycle();
        }

        startAutoCycle() {
            if (this.cycleInterval) clearInterval(this.cycleInterval);
            this.cycleInterval = setInterval(() => this.executeDecision(), 60000);
        }

        async executeDecision(prompt = null) {
            if (window.isAppPaused) return;
            const vector = await ContextManager.getNeuralVector();
            const action = await NanoAI.decide(vector, prompt);
            if (action !== 'IDLE' && action !== AI_INTENTS.IDLE) {
                await AppBridge.executeIntent(action);
            }
            return action;
        }

        async generateText(prompt) {
            const matchedIntent = NanoAI.detectIntent(prompt);

            if (this.nativeAvailable) {
                try { return await new Promise((res, rej) => AICore.generateText(prompt, res, rej)); } catch (e) { }
            }
            if (this.browserSession) {
                try { return (await this.browserSession.prompt(prompt)).trim(); } catch (e) { }
            }

            // Fallback
            if (matchedIntent && matchedIntent.confidence > 0.7) {
                const responses = {
                    'BUY_DATA': "📱 I've opened the 'Subscriptions' tab for you.",
                    'SHARE_DATA': "💸 Redirecting you to 'Share Credit'.",
                    'ACTIVATE_VOUCHER': "🎟️ Opening the voucher section.",
                    'CHECK_BALANCE': window.currentUser ? `💰 Balance: $${window.currentUser.credits || 0}` : "Please log in.",
                    'FIX_CONNECTION': "🔧 Initiating connection check."
                };
                if (responses[matchedIntent.intent]) return responses[matchedIntent.intent];
            }

            const context = await ContextManager.getFullContext();
            if (!context.internetAvailable) {
                return "I'm currently offline. I can help with local tasks like plans, vouchers, and connection status.";
            }
            return "I'm here to help with your Br3eze network connection.";
        }
    }

    /* ==================== 7. GLOBAL EXPOSE ==================== */
    window.ContextManager = ContextManager;
    window.OutcomeLearning = OutcomeLearning;
    window.NanoAI = NanoAI;
    window.AppBridge = AppBridge;
    window.PrivilegedBridge = PrivilegedBridge;
    window.aiOrchestrator = new AIOrchestrator();

    // Unified Surface
    window.AI = {
        init: () => window.aiOrchestrator.init(),
        decide: (p) => window.aiOrchestrator.executeDecision(p),
        chat: (p) => window.aiOrchestrator.generateText(p),
        instance: window.aiOrchestrator,
        processCommand: (t) => NanoAI.processCommand(t)
    };

    // Auto-boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.AI.init());
    } else {
        window.AI.init();
    }

})(window);