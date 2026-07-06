/* ==========================================================
   FILE: index.js
   DESCRIPTION: UI Utilities, Pagination, Notifications, and Wi-Fi Logic
   ========================================================== */
window.isAppPaused = false;

/* ==========================================================
   PWA: SERVICE WORKER + INSTALL PROMPT
   Skipped automatically inside Cordova (no navigator.serviceWorker
   registration is attempted there; the native shell handles caching).
   ========================================================== */
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.warn('[PWA] Service worker registration failed:', err);
        });
    });
}

window.deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredInstallPrompt = e;
    document.dispatchEvent(new CustomEvent('app:installable'));
});

window.AgentOSInstall = {
    async prompt() {
        if (!window.deferredInstallPrompt) return false;
        window.deferredInstallPrompt.prompt();
        const { outcome } = await window.deferredInstallPrompt.userChoice;
        window.deferredInstallPrompt = null;
        return outcome === 'accepted';
    },
    isAvailable() { return !!window.deferredInstallPrompt; }
};

/* ==========================================================
   Backend Server Remote WebSocket Bridge
   ========================================================== */
window.BackendBridge = {
    ws: null,
    connect: function() {
        this.ws = new WebSocket('ws://localhost:3000/ws');
        this.ws.onopen = () => console.log('[BackendBridge] WebSocket Connected');
        this.ws.onmessage = (e) => {
            try {
                const response = JSON.parse(e.data);
                console.log('[BackendBridge] Message from Backend:', response);
                safeShowToast(response.message || 'Action Completed', response.type === 'error' ? 'error' : 'success');
            } catch(err) {}
        };
        this.ws.onclose = () => {
            console.log('[BackendBridge] WebSocket Disconnected. Reconnecting in 3s...');
            setTimeout(() => this.connect(), 3000);
        };
        this.ws.onerror = (err) => console.error('[BackendBridge] WS Error', err);
    },
    sendIntent: function(intentName, payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'intent', intent: intentName, payload }));
        } else {
            console.warn('[BackendBridge] WS Offline. Intent queued or failed.', intentName);
            safeShowToast('Backend Offline. Cannot perform action.', 'error');
        }
    }
};
// Initiate connection immediately
window.BackendBridge.connect();

/* ==========================================================
   Global Intent Dispatcher (AgentOS AI Orchestrator link)
   ========================================================== */
window.dispatchGlobalIntent = async function(intentName, payload) {
    console.log(`[Intent Dispatch] ${intentName}`, payload);
    
    // Relay exact intent to the backend Node.js Server
    window.BackendBridge.sendIntent(intentName, payload);
};
/* ==========================================================
   1. GLOBAL UI UTILITIES
   ========================================================== */

// Global Loading Spinner
const Loading = {
    show(msg = 'Please wait...') {
        let el = document.getElementById('loadingOverlay');
        if (!el) {
            el = document.createElement('div');
            el.id = 'loadingOverlay';
            el.className = 'loading-overlay';
            el.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;flex-direction:column;justify-content:center;align-items:center;color:white;";
            el.innerHTML = `<div class="spinner"></div><div id="loadingText" style="margin-top:15px; font-family:sans-serif;">${msg}</div>`;
            document.body.appendChild(el);
        }
        const txt = document.getElementById('loadingText');
        if (txt) txt.textContent = msg;
        el.style.display = 'flex';
    },
    hide() {
        const el = document.getElementById('loadingOverlay');
        if (el) el.style.display = 'none';
    }
};

// Global Toast Notification
let toastTimeout;
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const iconEl = document.getElementById('toastIcon');
    const msgEl = document.getElementById('toastMessage');

    if (!toast || !iconEl || !msgEl) {
        console.log(`[Toast - ${type}] ${message}`);
        return;
    }

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const colors = { success: 'var(--color-success)', error: 'var(--color-danger)', info: 'var(--color-info)', warning: '#ffaa00' };

    toast.style.backgroundColor = colors[type] || colors.info;
    toast.style.color = 'var(--color-text-light)';
    toast.style.zIndex = '10000';

    iconEl.textContent = icons[type] || icons.info;
    msgEl.textContent = message;

    toast.classList.remove('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 4000);
}
window.showToast = showToast;

function safeShowToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else {
        console.warn(`[Toast Pending] ${message}`);
    }
}

/* ==========================================================
   2. PAGINATION HELPER
   ========================================================== */
const Pagination = {
    state: { users: 1, vouchers: 1, transactions: 1, tickets: 1, message: 1 },
    pageSize: 8,

    getPageData(data, pageName) {
        if (!data || !Array.isArray(data)) return { data: [], totalPages: 1, currentPage: 1 };

        if (!this.state[pageName]) this.state[pageName] = 1;
        const totalPages = Math.ceil(data.length / this.pageSize) || 1;

        if (this.state[pageName] > totalPages) this.state[pageName] = totalPages;
        if (this.state[pageName] < 1) this.state[pageName] = 1;

        const start = (this.state[pageName] - 1) * this.pageSize;
        const end = start + this.pageSize;

        return {
            data: data.slice(start, end),
            totalPages: totalPages,
            currentPage: this.state[pageName]
        };
    },

    renderControls(pageName, totalPages, renderFunctionString) {
        if (totalPages <= 1) return '';
        const current = this.state[pageName];
        const prevDisabled = current === 1 ? 'disabled' : '';
        const nextDisabled = current === totalPages ? 'disabled' : '';

        // Added 'window.' to callback to ensure it hits global scope
        return `
            <div class="pagination-controls">
                <span class="pagination-info">Page ${current} of ${totalPages}</span>
                <button ${prevDisabled} onclick="Pagination.changePage('${pageName}', -1, '${renderFunctionString}')"><i class="fas fa-chevron-left"></i></button>
                <button ${nextDisabled} onclick="Pagination.changePage('${pageName}', 1, '${renderFunctionString}')"><i class="fas fa-chevron-right"></i></button>
            </div>
        `;
    },

    changePage(pageName, direction, renderCallbackName) {
        this.state[pageName] += direction;
        if (typeof window[renderCallbackName] === 'function') {
            window[renderCallbackName]();
        } else {
            console.error(`Pagination callback '${renderCallbackName}' not found in global scope.`);
        }
    }
};
window.Pagination = Pagination; // Export

/* ==========================================================
   3. FEEDBACK SYSTEM (SOUND & VIBRATION)
   ========================================================== */
const Feedback = {
    beep(freq = 600, duration = 200, type = 'sine') {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;

            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type;
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + (duration / 1000));
            setTimeout(() => {
                osc.stop();
                ctx.close();
            }, duration);
        } catch (e) {
            console.warn('Audio feedback failed', e);
        }
    },

    success() {
        if (navigator.vibrate) navigator.vibrate(50);
        this.beep(800, 150, 'sine');
    },

    alert() {
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        this.beep(400, 300, 'square');
    },

    danger() {
        if (navigator.vibrate) navigator.vibrate([400, 100, 400, 100, 400]);
        this.beep(150, 600, 'sawtooth');
    }
};

window.Feedback = Feedback;

/* ==========================================================
   4. CORDOVA SETUP & PERMISSIONS
   ========================================================== */
document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
    console.log(`Cordova Ready: ${cordova.platformId}@${cordova.version}`);

    if (typeof WifiWizard2 === 'undefined') {
        console.warn('WifiWizard2 plugin missing. Running in browser mode?');
        if (cordova.platformId === 'android') safeShowToast('Wi-Fi features unavailable (Plugin missing)', 'warning');
    } else {
        PermissionsHelper.configureBackgroundMode();
        initializeNotificationChannel();
        initializeWifiFeatures();
    }
    document.addEventListener("backbutton", onBackKeyDown, false);
}

function onBackKeyDown(e) {
    e.preventDefault();

    // 1. Close open modals
    const openModal = document.querySelector('.modal:not(.hidden)');
    if (openModal) {
        const id = openModal.id;
        if (typeof window.closeModal === 'function') {
            window.closeModal(id);
            return;
        }
    }

    // 2. Close sidebar if open (mobile)
    const sidebar = document.getElementById('sidebar');
    if (sidebar && !sidebar.classList.contains('hidden')) {
        // Assuming there's a toggle logic or just hide it
        sidebar.classList.add('hidden');
        return;
    }

    // 3. Return to home section if in another section
    const activeLi = document.querySelector('.sidebar li.active');
    if (activeLi && activeLi.getAttribute('data-section') !== 'home') {
        if (typeof window.showSection === 'function') {
            window.showSection('home');
            return;
        }
    }

    // 4. Default: Exit/Minimize
    if (confirm("Exit Power Connect?")) {
        navigator.app.exitApp();
    }
}


function initializeNotificationChannel() {
    if (typeof cordova !== 'undefined' && cordova.plugins?.notification?.local) {
        // Listen for the click event
        cordova.plugins.notification.local.on('click', function (notification) {
            cordova.plugins.notification.local.clear(notification.id);
            console.log("Notification clicked and cleared:", notification.id);
        });

        if (typeof device !== 'undefined' && device.platform === 'Android') {
            // Safe access to version check
            const version = (device.version && device.version.indexOf('.') > -1)
                ? parseInt(device.version.split('.')[0])
                : 0;

            if (version >= 8) {
                cordova.plugins.notification.local.createChannel({
                    id: 'power_connect_alerts',
                    name: 'Wi-Fi Access Alerts',
                    description: 'Notifications about plan status and connection.',
                    importance: 5
                });
            }
        }
    }
}

async function initializeWifiFeatures() {
    try {
        console.log('[AgentOS] Initializing WiFi Agent Layer...');

        // 1. Request Basic Permissions
        if (typeof WifiWizard2 !== 'undefined') {
            await WifiWizard2.requestPermission().catch(e => console.warn("Wifi Permission Error:", e));
        }

        // 2. Request Android 12+ Specific Permissions
        await requestNearbyWifiDevicesPermission();

        // 3. Initialize Agent Orchestrator
        if (window.AgentOrchestrator) {
            await window.AgentOrchestrator.init();
        }

        // 4. Wait for Login/DataStore
        const dataStoreReady = await waitForDataStore();
        if (!dataStoreReady) {
            console.log('DataStore load timeout. User might not be logged in yet.');
        }

        // 5. Start Network Logic
        if (window.NetworkTools) {
            await window.NetworkTools.initialize();
        }
    } catch (err) {
        console.error('Init Error:', err);
        safeShowToast('Permission denied. Wi-Fi disabled.', 'warning');
    }
}

function waitForDataStore(timeout = 10000) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            // Check if user is logged in AND DataStore exists
            if (typeof DataStore !== 'undefined' && typeof currentUser !== 'undefined' && currentUser !== null) {
                clearInterval(checkInterval);
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                console.log('DataStore load timeout or User not logged in.');
                resolve(false);
            }
        }, 500);
    });
}

const PermissionsHelper = {
    async requestAll() {
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.permissions) return;

        const permissions = cordova.plugins.permissions;
        const list = [
            permissions.ACCESS_FINE_LOCATION,
            permissions.ACCESS_COARSE_LOCATION
        ];

        // Android 13+ (API 33) Support
        if (device.platform === 'Android' && parseInt(device.version) >= 12) {
            const NEARBY_WIFI = permissions.NEARBY_WIFI_DEVICES || 'android.permission.NEARBY_WIFI_DEVICES';
            list.push(NEARBY_WIFI);
        }

        return new Promise((resolve) => {
            permissions.requestPermissions(list,
                (status) => { console.log('Permissions granted:', status); resolve(true); },
                (err) => { console.warn('Permissions denied:', err); resolve(false); }
            );
        });
    },

    configureBackgroundMode() {
        if (typeof cordova !== 'undefined' && cordova.plugins?.backgroundMode) {
            cordova.plugins.backgroundMode.setDefaults({
                title: 'Power Connect',
                text: 'Monitoring connection...',
                icon: 'icon',
                color: '203060',
                resume: true,
                hidden: false,
                bigText: false,
                channelName: 'Power Connect Service',
                channelDescription: 'Keeps connection monitoring active'
            });

            // Prevent app from sleeping
            cordova.plugins.backgroundMode.enable();
            cordova.plugins.backgroundMode.disableWebViewOptimizations();

            cordova.plugins.backgroundMode.on('activate', () => {
                window.isAppPaused = true;
                cordova.plugins.backgroundMode.disableWebViewOptimizations();
                console.log('🔄 Background mode active, continuing sync...');
                if (window.OfflineOrchestrator) window.OfflineOrchestrator.resume();

                if (window.NetworkTools?.isInitialized) {
                    console.log('App in background: slowing down checks');
                    window.NetworkTools.startConnectionMonitoring(60000); // Check every minute in background
                }
            });

            cordova.plugins.backgroundMode.on('deactivate', () => {
                window.isAppPaused = false;
                if (window.OfflineOrchestrator) window.OfflineOrchestrator.pause();

                if (window.NetworkTools?.isInitialized) {
                    console.log('App in foreground: monitoring active');
                    window.NetworkTools.startConnectionMonitoring(10000); // Check every 10s in foreground
                }
            });
        }
    },

    checkBattery() {
        if (typeof navigator.getBattery === 'function') {
            navigator.getBattery().then(battery => {
                if (battery.level < 0.15 && !battery.charging) {
                    showToast("Battery low! WiFi may be optimized by OS.", "warning");
                }
            });
        }
    }
};

/* ==========================================================
   5. NOTIFICATION & DEVICE HELPERS
   ========================================================== */
function sendNotification(title, text, id) {
    if (typeof cordova !== 'undefined' && cordova.plugins?.notification?.local) {
        cordova.plugins.notification.local.schedule({
            id: id,
            title: title,
            text: text,
            channel: 'power_connect_alerts',
            sticky: true,
            foreground: true,
            sound: true,
            vibrate: true
        });
    }
    // Also add to chat log if global helper exists
    if (window.addChatMessage) {
        window.addChatMessage(text, 'system');
    }
}

function cancelNotification(id) {
    if (typeof cordova !== 'undefined' && cordova.plugins?.notification?.local) {
        cordova.plugins.notification.local.cancel(id);
    }
}


/* ==========================================================
   6. AGENT ORCHESTRATOR (AgentOS Core)
   ========================================================== */
window.AgentOrchestrator = {
    initialized: false,
    agents: {},

    async init() {
        if (this.initialized) return;
        console.log('[AgentOS] Initializing Orchestrator...');

        // Register Core Agents (Represented here for the UI)
        this.agents.wifi = {
            name: 'WiFiAgent',
            status: 'active',
            lastScan: Date.now()
        };

        this.agents.billing = {
            name: 'BillingAgent',
            status: 'active'
        };

        // Initialize Distributed Gossip Node
        this.agents.gossip = {
            name: 'GossipAgent',
            status: 'syncing',
            peers: 0
        };

        // 1. Initialize Plugin CoreAgent if available
        if (typeof CoreAgent !== 'undefined') {
            const agent = CoreAgent.getInstance ? CoreAgent.getInstance() : CoreAgent;
            if (agent.initialize) agent.initialize();
            if (typeof EventBus !== 'undefined' && agent.setEventBus) agent.setEventBus(EventBus);
        }

        this.initialized = true;
        EventBus.emit('orchestrator:ready', { timestamp: Date.now() });

        // Listen for AI recommendations
        EventBus.on('ai:recommendation', (data) => {
            console.log('[AgentOS] AI Recommendation Received:', data);
            if (window.showToast) {
                window.showToast(`🤖 AI: ${data.message}`, 'info');
            }
        });
    },

    async processIntent(input) {
        console.log(`[AgentOS] Processing Intent: ${input}`);
        // Bridge to Unified AI Orchestrator
        if (window.AI && window.AI.chat) {
            return await window.AI.chat(input);
        }
        return { status: 'unsupported', message: 'AI Orchestrator not loaded' };
    }
};

/* ==========================================================
   7. NETWORK TOOLS LOGIC 
   ========================================================== */
window.NetworkTools = {
    isInitialized: false,
    connectionCheckInterval: null,
    initializationLock: false,
    isConnecting: false,
    lastKnownSSID: null,

    NOTIFICATION_ID_PLAN_EXPIRED: 101,
    NOTIFICATION_ID_CONNECTION_REQUIRED: 102,

    isPluginAvailable() {
        return typeof WifiWizard2 !== 'undefined';
    },

    async initialize() {
        if (this.initializationLock) return;
        this.initializationLock = true;

        try {
            console.log('[AgentOS] Initializing NetworkTools via Agents...');

            // 1. Notify Orchestrator
            EventBus.emit('network:init_start', { timestamp: Date.now() });

           // 1.1. Setup Permissions & Background Mode
            await PermissionsHelper.requestAll();
            PermissionsHelper.configureBackgroundMode();

            
            // 1.2. Basic WifiWizard Permission (Legacy)
            if (typeof WifiWizard2 !== 'undefined') {
                await WifiWizard2.requestPermission().catch(e => console.warn("WifiWizard2 Permission Error:", e));
            }

            const currentSSID = await this.displayConnectionInfo();

            // 2. CHECK PLAN
            if (typeof DataStore === 'undefined') {
                this.startConnectionMonitoring();
                return;
            }

            // Check if user has a valid plan
            // DataStore.getNetworkSettings handles the "currentUser is null" check internally now
            const cfg = await DataStore.getNetworkSettings(currentUser ? currentUser.id : null).catch(() => null);

            if (!cfg) {
                console.warn("No config received from DataStore");
                this.startConnectionMonitoring();
                return;
            }

          
            // 3. AUTO-SUGGEST PARTNER NETWORKS (ROAMING)
            if (cfg.accessGranted && cfg.partnerNetworks && cfg.partnerNetworks.length > 0) {
                await this.suggestPartnerNetworks(cfg.partnerNetworks);
            }
            
            if (cfg.accessGranted && cfg.ssid) {
                // --- ACCESS GRANTED ---
                cancelNotification(this.NOTIFICATION_ID_PLAN_EXPIRED);
                if (currentSSID === cfg.ssid) {
                    safeShowToast(`Connected to ${cfg.ssid}`, 'success');
                } else {
                    await this.connectToWifi(cfg);
                }
            } else {
                // --- ACCESS DENIED (Poison) ---
                if (currentSSID === cfg.ssid) {
                    console.warn("Plan invalid. Applying Security Policy...");
                    sendNotification('⚠️ Plan Expired', `Plan expired. Disconnecting from ${cfg.ssid}.`, this.NOTIFICATION_ID_PLAN_EXPIRED);
                    safeShowToast("Plan Expired - Disconnecting", "warning");
                    await this.applyPoison(cfg);
                }

                this.startConnectionMonitoring();
            }
        } catch (err) {
            console.error('NetworkTools Init Failed:', err);
            EventBus.emit('network:error', err);
        } finally {
            this.isInitialized = true;
            this.initializationLock = false;
            EventBus.emit('network:init_complete');
        }
    },

    async connectToWifi(cfg) {
        const androidVer = this.getAndroidVersion();
        EventBus.emit('wifi:connecting', { ssid: cfg.ssid });

        try {
            if (androidVer >= 10) {
                // Android 10+ Suggestion API
                const config = { SSID: cfg.ssid, password: cfg.password, authType: "WPA", isHiddenSSID: false };
                if (typeof WifiWizard2.suggest === 'function') {
                    await WifiWizard2.suggest(config);
                } else if (typeof WifiWizard2.suggestConnection === 'function') {
                    await WifiWizard2.suggestConnection(cfg.ssid, cfg.password, "WPA", false);
                } else {
                    await WifiWizard2.connect(cfg.ssid, true, cfg.password, 'WPA', false);
                }
                safeShowToast(`"${cfg.ssid}" suggested. Tap to connect.`, 'success');
                sendNotification('Tap and Connect ', `Tap to connect to ${cfg.ssid}`, this.NOTIFICATION_ID_CONNECTION_REQUIRED);
            } else {
                // Legacy Android Connect
                safeShowToast(`Connecting to ${cfg.ssid}...`, 'info');
                await WifiWizard2.connect(cfg.ssid, true, cfg.password, 'WPA', false);
                safeShowToast(`Connected to ${cfg.ssid}`, 'success');
            }
            EventBus.emit('wifi:connected', { ssid: cfg.ssid });
        } catch (err) {
            console.error("Connect Error", err);
            EventBus.emit('wifi:error', err);
        }
    },

    async applyPoison(poisonCfg) {
        const ssid = poisonCfg.ssid;
        const badPassword = poisonCfg.password || "x_" + Date.now();
        const androidVer = this.getAndroidVersion();

        try {
            if (androidVer < 10) {
                await WifiWizard2.disconnect(ssid).catch(() => { });
                await WifiWizard2.remove(ssid).catch(() => { });
                return;
            }

            const poisonObj = { SSID: ssid, password: badPassword, authType: "WPA", isAppInteraction: true };

            if (typeof WifiWizard2.suggest === 'function') {
                await WifiWizard2.suggest(poisonObj);
            } else if (typeof WifiWizard2.suggestConnection === 'function') {
                await WifiWizard2.suggestConnection(ssid, badPassword, "WPA", false);
            }

            setTimeout(async () => {
                if (typeof WifiWizard2 !== 'undefined') {
                    await WifiWizard2.connect(ssid, false, badPassword, "WPA", false).catch(() => { });
                }
            }, 1500);

            setTimeout(async () => {
                const check = await this.getCleanSSID();
                if (check === ssid) {
                    safeShowToast('Please disconnect in Settings', 'warning');
                    this.openWifiSettings();
                }
            }, 4000);

        } catch (e) {
            console.warn("Poison application error", e);
            this.openWifiSettings();
        }
    },

    async guardHotspot() {
        try {
            if (typeof DataStore === 'undefined') return;

            const currentSSID = await this.getCleanSSID();
            if (!currentSSID) return;

            const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
            const cfg = await DataStore.getNetworkSettings(uid).catch(() => null);

            if (!cfg || !cfg.ssid) return;

            // 1. If connected to target network AND DataStore says "Access Denied"
            if (currentSSID === cfg.ssid && cfg.accessGranted === false) {
                console.warn('Security: Plan expired or User Logged Out (DataStore denied access).');

                // Apply the poison configuration
                await this.applyPoison(cfg);

                if (typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200]);
            } else {
                cancelNotification(this.NOTIFICATION_ID_PLAN_EXPIRED);
            }

            // 2. Check Partner Networks (Roaming)
            if (cfg.partnerNetworks && cfg.partnerNetworks.length > 0) {
                const connectedPartner = cfg.partnerNetworks.find(p => p.ssid === currentSSID);
                if (connectedPartner) {
                    if (cfg.accessGranted === false) {
                        console.warn(`Security: Roaming Plan expired ${currentSSID}.`);
                        await this.applyPoison({ ssid: currentSSID, password: "EXP_" + Date.now() });
                    } else if (this.lastLoggedSSID !== currentSSID) {
                        await this.logRoamingConnection(connectedPartner);
                    }
                }
            }
        } catch (err) {
            console.error('guardHotspot error:', err);
        }
    },

    async performSecuritycheck() {
        console.log("[AgentOS] Performing background security check...");
        return this.guardHotspot();
    },

    async suggestPartnerNetworks(networks) {
        if (!this.isPluginAvailable()) return;
        const androidVer = this.getAndroidVersion();

        try {
            if (androidVer >= 10 && typeof WifiWizard2.suggest === 'function') {
                console.log(`[Roaming] Suggesting ${networks.length} partner networks to OS...`);
                for (const net of networks) {
                    if (!net.active) continue;
                    // Register each active partner network as a suggestion
                    await WifiWizard2.suggest({
                        SSID: net.ssid,
                        password: net.password,
                        authType: "WPA",
                        isHiddenSSID: false
                    }).catch(e => console.warn(`Suggestion failed for ${net.ssid}`, e));
                }
            } else {
                console.log('[Roaming] Automatic suggestions only supported on Android 10+. Ready for manual connect.');
            }
        } catch (e) {
            console.error('Roaming suggestion error:', e);
        }
    },

    async logRoamingConnection(partner) {
        if (typeof DataStore === 'undefined' || !currentUser) return;
        try {
            console.log(`[Roaming] Auto-logging connection to ${partner.ssid}`);
            await DataStore.logConnection(partner.id, partner.partnerId, currentUser.id);
            this.lastLoggedSSID = partner.ssid;
            safeShowToast(`Roaming: Connected to ${partner.ssid}`, 'success');

            // Trigger IP update after roaming connection
            if (typeof window.captureLocalDeviceInfo === 'function') {
                window.captureLocalDeviceInfo().catch(() => { });
            }
        } catch (e) {
            console.warn('Failed to log roaming connection', e);
        }
    },

    async displayConnectionInfo() {
        const cleanSSID = await this.getCleanSSID();
        // Trigger device info update if SSID changed
        if (cleanSSID && cleanSSID !== this.lastKnownSSID) {
            console.log(`[NetworkTools] SSID Change detected: ${this.lastKnownSSID} -> ${cleanSSID}`);
            if (typeof window.captureLocalDeviceInfo === 'function') {
                window.captureLocalDeviceInfo().catch(() => { });
            }
        }
        this.lastKnownSSID = cleanSSID;
        const statusEl = document.getElementById('wifiStatusText');
        if (statusEl) statusEl.textContent = cleanSSID || 'Not Connected';
        return cleanSSID;
    },

    async getCleanSSID() {
        if (!this.isPluginAvailable()) return null;
        try {
            const raw = await WifiWizard2.getConnectedSSID();
            if (!raw || raw === '<unknown ssid>' || raw.includes('0x')) return null;
            return raw.replace(/"/g, '');
        } catch (e) {
            return null;
        }
    },

    async autoConnectToConfiguredWifi(cfg) {
        if (this.isConnecting) {
            console.log("[NetworkTools] Connection already in progress, skipping...");
            return false;
        }

        // Don't auto-connect if app is in background (unless explicitly allowed)
        if (window.isAppPaused) {
            console.log("[NetworkTools] App is paused, skipping auto-connect.");
            return false;
        }

        this.isConnecting = true;
        try {
            // Disconnect first to ensure clean state
            await WifiWizard2.disconnect().catch(() => { });

            safeShowToast(`Connecting to ${cfg.ssid}...`, 'info');
            // Add small delay to allow disconnect to settle
            await new Promise(r => setTimeout(r, 1000));

            await WifiWizard2.connect(cfg.ssid, true, cfg.password, 'WPA', false);
            safeShowToast(`Connected to ${cfg.ssid}`, 'success');
            return true;
        } catch (err) {
            console.error('Legacy connect failed:', err);
            safeShowToast(`Connection failed: ${err.message || err}`, 'error');
            return false;
        } finally {
            this.isConnecting = false;
        }
    },

    startConnectionMonitoring(intervalMs = 300000) {
        this.stopConnectionMonitoring();
        if (typeof WifiWizard2 === 'undefined') return;
        this.isPoisoning = false;
        this.connectionCheckInterval = setInterval(async () => {
            if (this.isPoisoning) return;
            await this.displayConnectionInfo();
            await this.guardHotspot();
        }, intervalMs);
    },

    stopConnectionMonitoring() {
        if (this.connectionCheckInterval) {
            clearInterval(this.connectionCheckInterval);
            this.connectionCheckInterval = null;
        }
    },

    async disconnect(ssid) {
        if (!ssid || typeof WifiWizard2 === 'undefined') return false;

        console.log(`[NetworkTools] Disconnecting strategy for: ${ssid}`);
        const androidVer = this.getAndroidVersion();

        try {
            // STRATEGY 1: Legacy (Android 9-)
            if (androidVer < 10) {
                await WifiWizard2.disconnect(ssid).catch(e => console.warn(e));
                await WifiWizard2.remove(ssid).catch(e => console.warn(e));
                safeShowToast('Disconnected', 'info');
                return true;
            }

            // STRATEGY 2: Android 10+ (Removal Priority)
            try {
                await WifiWizard2.remove(ssid);
            } catch (e) {
                console.warn('Remove suggestion failed or not applicable', e);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));

            let currentSSID = await this.getCleanSSID();
            if (currentSSID !== ssid) {
                safeShowToast('Disconnected', 'info');
                return true;
            }

            // STRATEGY 3: Poison Pill (Fallback)
            const poisonConfig = {
                SSID: ssid,
                password: "x_" + Date.now() + Math.random().toString(36).substring(7),
                authType: "WPA",
                isAppInteraction: true
            };

            try {
                if (typeof WifiWizard2.suggest === 'function') {
                    await WifiWizard2.suggest(poisonConfig);
                } else if (typeof WifiWizard2.suggestConnection === 'function') {
                    await WifiWizard2.suggestConnection(ssid, poisonConfig.password, "WPA", false);
                }
                // Safety check before connecting
                if (typeof WifiWizard2 !== 'undefined') {
                    await WifiWizard2.connect(ssid, false, poisonConfig.password, "WPA", false).catch(() => { });
                }
                await new Promise(resolve => setTimeout(resolve, 2500));
            } catch (e) {
                console.warn("Poison injection failed", e);
            } finally {
                if (typeof WifiWizard2 !== 'undefined' && typeof WifiWizard2.remove === 'function') {
                    await WifiWizard2.remove(ssid).catch(() => { });
                }
            }

            currentSSID = await this.getCleanSSID();

            if (currentSSID === ssid) {
                safeShowToast('Please disconnect in Settings', 'warning');
                this.openWifiSettings();
                return false;
            }

            safeShowToast('Disconnected successfully', 'info');
            return true;

        } catch (err) {
            console.error('Disconnect error:', err);
            return false;
        }
    },

    getAndroidVersion() {
        if (typeof device === 'undefined') return 0;
        return (device.platform === 'Android') ? Math.floor(Number(device.version) || 0) : 0;
    },

    openWifiSettings() {
        if (typeof cordova !== 'undefined' && cordova.plugins?.settings) {
            cordova.plugins.settings.open("wifi");
        }
    },

    cleanup() {
        this.stopConnectionMonitoring();
        cancelNotification(this.NOTIFICATION_ID_PLAN_EXPIRED);
        cancelNotification(this.NOTIFICATION_ID_CONNECTION_REQUIRED);

        // Notify Agents
        EventBus.emit('network:cleanup');

        this.isInitialized = false;
        this.initializationLock = false;
    },

    // Bridge to Native Gossip Service
    syncMesh() {
        if (typeof cordova !== 'undefined' && cordova.plugins?.WiFiBillingAgent) {
            cordova.plugins.WiFiBillingAgent.syncGossip((data) => {
                if (window.AgentOrchestrator && window.AgentOrchestrator.agents.gossip) {
                    window.AgentOrchestrator.agents.gossip.peers = data.peerCount;
                }
                EventBus.emit('mesh:sync_complete', data);
            }, (err) => {
                console.error('Mesh sync failed', err);
            });
        }
    }
};

        /* ==========================================================
           7. VBB (Volume-Variable Billing) - Traffic Accounting
           ========================================================== */
        let trafficInterval = null;

        function startTrafficAccounting(intervalMs = 60000) {
            if (trafficInterval) clearInterval(trafficInterval);

            trafficInterval = setInterval(async () => {
                if (!currentUser || !navigator.onLine) return;

                // 1. Get current subscription
                const sub = typeof getActiveSubscription === 'function' ? getActiveSubscription() : null;
                if (!sub) return;

                // 2. Read Real Traffic from DataMeter
                const bytesUsed = window.DataMeter ? window.DataMeter.getCurrentUsage() : 0;
                const gbConsumed = bytesUsed / (1024 * 1024 * 1024);

                if (gbConsumed <= 0) return;

                console.log(`[VBB] Accounting: Consumed ${(bytesUsed / (1024 * 1024)).toFixed(2)}MB total this session.`);

                // 3. Update Firestore (Atomic Increment)
                try {
                    const dbInstance = typeof db !== 'undefined' ? db : (typeof firebase !== 'undefined' ? firebase.firestore() : null);
                    if (!dbInstance) return;

                    const userRef = dbInstance.collection('users').doc(currentUser.id);

                    // We use the dataConsumed field in the subscription object
                    // Note: For simplicity in this stub-fix, we update the whole subscriptions array
                    // In a production app, we'd use a more targeted update or a separate sub-collection
                    const userDoc = await userRef.get();
                    if (!userDoc.exists) return;

                    const subs = userDoc.data().subscriptions || [];
                    let limitReached = false;

                    const updatedSubs = subs.map(s => {
                        if (s.planId === sub.planId && s.purchasedAt.seconds === sub.purchasedAt.seconds) {
                            const newConsumed = (s.dataConsumed || 0) + gbConsumed;
                            if (s.dataLimit > 0 && newConsumed >= s.dataLimit) {
                                limitReached = true;
                            }
                            return { ...s, dataConsumed: newConsumed };
                        }
                        return s;
                    });

                    await userRef.update({ subscriptions: updatedSubs });

                    // 4. Handle Limit Reached
                    if (limitReached) {
                        console.log("[VBB] Data limit reached! Disconnecting...");
                        clearInterval(trafficInterval);
                        trafficInterval = null;
                        if (window.NetworkTools && window.NetworkTools.disconnect) {
                            await window.NetworkTools.disconnect(sub.ssid || "Limit Reached");
                        }
                        if (typeof safeShowToast === 'function') {
                            safeShowToast("Data limit reached. Please renew.", "error");
                        }
                    }
                } catch (e) {
                    console.error('[VBB] Firestore update failed:', e);
                }
            }, intervalMs);
        }
        /* ==========================================================
           8. DEVICE INFO CAPTURE
           ========================================================== */
        window.captureLocalDeviceInfo = async () => {
            if (!window.currentUser || typeof db === 'undefined') return;
            try {
                const telemetry = {
                    lastIP: 'Unknown',
                    lastSSID: null,
                    deviceModel: typeof device !== 'undefined' ? `${device.manufacturer} ${device.model}` : 'Web Browser',
                    platform: typeof device !== 'undefined' ? device.platform : 'Web',
                    deviceId: typeof device !== 'undefined' ? device.uuid : 'WebClient',
                    osVersion: typeof device !== 'undefined' ? device.version : 'Unknown',
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                };

                if (typeof WifiWizard2 !== 'undefined') {
                    telemetry.lastIP = await WifiWizard2.getWifiIP().catch(() => 'Unknown');
                    telemetry.lastSSID = await window.NetworkTools.getCleanSSID();
                }

                // Device info
                if (typeof device !== 'undefined') {
                    telemetry.deviceModel = `${device.manufacturer} ${device.model}`;
                    telemetry.platform = device.platform;
                    telemetry.deviceId = device.uuid;
                    telemetry.osVersion = device.version;
                } else {
                    telemetry.deviceId = 'WebClient';
                }

                await db.collection('users')
                    .doc(window.currentUser.id)
                    .update(telemetry);

                console.log('[Telemetry] Device info updated');
            } catch (e) {
                console.warn('[Telemetry] Update failed:', e);
            }
        };

        /* ==========================================================
           9. OFFLINE QUEUE UI INDICATOR
           ========================================================== */
        function renderOfflineQueueIndicator() {
            if (!window.OfflineSyncManager) return;
            const status = window.OfflineSyncManager.getQueueStatus();
            if (status.total === 0) return;

            let indicator = document.getElementById('offlineQueueIndicator');

            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'offlineQueueIndicator';
                indicator.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: var(--color-info, #1976d2);
            color: white;
            padding: 10px 15px;
            border-radius: 20px;
            font-size: 0.85rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1000;
            animation: pulse 2s infinite;
        `;
                document.body.appendChild(indicator);
            }

            indicator.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> ${status.pending} pending sync`;
            indicator.style.display = 'flex';
        }

        // Update indicator periodically
        setInterval(renderOfflineQueueIndicator, 5000);

        /* ==========================================================
           10. NETWORK STATUS MONITORING
           ========================================================== */
        window.addEventListener('offline', () => {
            const badge = document.getElementById('offlineBadge');
            if (badge) badge.classList.add('active');
            showToast('📵 Offline. Actions will be queued.', 'warning');
        });

        window.addEventListener('online', () => {
            const badge = document.getElementById('offlineBadge');
            if (badge) badge.classList.remove('active');
            showToast('🌐 Back online! Syncing...', 'success');
        });

        /* ==========================================================
           11. APP LIFECYCLE LISTENERS
           ========================================================== */
        document.addEventListener('pause', () => {
            if (window.NetworkTools) window.NetworkTools.stopConnectionMonitoring();
        }, false);

        document.addEventListener('resume', () => {
            if (window.NetworkTools && window.NetworkTools.isInitialized) {
                window.NetworkTools.startConnectionMonitoring(10000);
                window.NetworkTools.displayConnectionInfo();
                window.NetworkTools.performSecuritycheck();
            }
        }, false);

        window.addEventListener('beforeunload', () => {
            if (window.NetworkTools) window.NetworkTools.cleanup();
        });

        document.addEventListener('DOMContentLoaded', () => {
            if (!navigator.onLine) {
                const badge = document.getElementById('offlineBadge');
                if (badge) badge.classList.add('active');
            }
        });

        /* ==========================================================
           12. DATA METER
           ========================================================== */
        const DataMeter = {
            metrics: {
                lastTime: Date.now(),
                prevBytes: 0,
                currentSpeed: 0
            },
            startSession(userId) {
                if (typeof window.NativeTrafficStats !== 'undefined') {
                    this.startBytes = window.NativeTrafficStats.getTotalWifiBytes();
                    this.metrics.prevBytes = this.startBytes;
                    this.currentUserId = userId;
                    this.isMonitoring = true;
                }
            },
            getTelemetry() {
                if (!this.isMonitoring || typeof window.NativeTrafficStats === 'undefined') return null;
                const nowBytes = window.NativeTrafficStats.getTotalWifiBytes();
                const nowTime = Date.now();
                const used = nowBytes - this.startBytes;
                const timeDiff = (nowTime - this.metrics.lastTime) / 1000;
                const bytesDiff = nowBytes - this.metrics.prevBytes;
                this.metrics.currentSpeed = (bytesDiff / 1024) / (timeDiff || 1);

                // Update tracking
                this.metrics.prevBytes = nowBytes;
                this.metrics.lastTime = nowTime;

                // Simulate RSSI (Replace with actual WifiWizard2 call if available)
                const rssi = -50 - Math.floor(Math.random() * 30);

                return {
                    used: used,
                    speed: this.metrics.currentSpeed.toFixed(1),
                    rssi: rssi,
                    quality: rssi > -70 ? 'Excellent' : (rssi > -85 ? 'Fair' : 'Poor')
                };
            },
            getCurrentUsage() {
                if (!this.isMonitoring || typeof window.NativeTrafficStats === 'undefined') return 0;
                const nowBytes = window.NativeTrafficStats.getTotalWifiBytes();
                return nowBytes - this.startBytes;
            },
            async checkLimit(planLimit) {
                const used = this.getCurrentUsage();
                if (used >= planLimit) {
                    this.isMonitoring = false;
                    if (window.NetworkTools && window.NetworkTools.disconnect) {
                        await window.NetworkTools.disconnect("Limit Reached");
                    }
                    safeShowToast("Data limit reached. Please renew.", "error");
                }
            }
        };
        window.DataMeter = DataMeter;