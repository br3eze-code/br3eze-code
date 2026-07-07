/* ==========================================================
   FILE: index.js
   DESCRIPTION: UI Utilities, Pagination, Notifications, and Wi-Fi Logic
   ========================================================== */
const $ = s => document.querySelector(s);
window.isAppPaused = false;
window.currentUser = JSON.parse(localStorage.getItem('user_session') || 'null');

/* ==========================================================
   0. LOGGER & DIAGNOSTICS
   ========================================================== */
const Logger = {
    info: (m, d) => console.log(`%c[INFO] ${m}`, "color: #00C6FF", d || ""),
    warn: (m, d) => console.warn(`%c[WARN] ${m}`, "color: #ffaa00", d || ""),
    error: (m, d) => console.error(`%c[ERROR] ${m}`, "color: #ff4d4d", d || ""),
    debug: (m, d) => console.debug(`%c[DEBUG] ${m}`, "color: #888", d || "")
};
window.Logger = Logger;

// Global Loading Spinner — with a watchdog so a missed hide() can never trap
// the user behind an infinite overlay (a recurring bug class in this app).
const Loading = {
    _watchdog: null,
    _WATCHDOG_MS: 20000,
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

        if (this._watchdog) clearTimeout(this._watchdog);
        this._watchdog = setTimeout(() => {
            console.warn(`[Loading] Watchdog fired after ${this._WATCHDOG_MS}ms — force-hiding stuck overlay ("${msg}").`);
            this.hide();
        }, this._WATCHDOG_MS);
    },
    hide() {
        if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
        const el = document.getElementById('loadingOverlay');
        if (el) el.style.display = 'none';
    }
};
window.Loading = Loading;

// Global Toast Notification — queued so rapid successive toasts each get their
// moment instead of the last one clobbering the rest. Backward compatible:
// showToast(message, type[, durationMs]).
const _toastQueue = [];
let _toastActive = false;
function _drainToasts() {
    const toast = document.getElementById('toast');
    const iconEl = document.getElementById('toastIcon');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !iconEl || !msgEl) {
        _toastQueue.splice(0).forEach(t => console.log(`[Toast - ${t.type}] ${t.message}`));
        _toastActive = false;
        return;
    }
    const next = _toastQueue.shift();
    if (!next) { _toastActive = false; return; }
    _toastActive = true;

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const colors = { success: 'var(--color-success)', error: 'var(--color-danger)', info: 'var(--color-info)', warning: '#ffaa00' };

    toast.style.backgroundColor = colors[next.type] || colors.info;
    toast.style.color = 'var(--color-text-light)';
    toast.style.zIndex = '10000';
    iconEl.textContent = icons[next.type] || icons.info;
    msgEl.textContent = next.message;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
        setTimeout(_drainToasts, 250); // brief gap between toasts
    }, next.duration);
}
function showToast(message, type = 'info', duration = 4000) {
    // Collapse an identical message already queued/showing (avoid spam).
    const last = _toastQueue[_toastQueue.length - 1];
    if (last && last.message === message && last.type === type) return;
    _toastQueue.push({ message, type, duration: Math.max(1500, duration) });
    if (_toastQueue.length > 5) _toastQueue.splice(0, _toastQueue.length - 5); // cap backlog
    if (!_toastActive) _drainToasts();
}
window.showToast = showToast;

function safeShowToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    } else {
        console.warn(`[Toast Pending] ${message}`);
    }
}

// Small shared DOM/util helpers used across the app.
window.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
window.debounce = (fn, wait = 250) => {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
};
window.throttle = (fn, wait = 250) => {
    let last = 0, timer = null;
    return function (...args) {
        const now = Date.now();
        const remaining = wait - (now - last);
        if (remaining <= 0) { last = now; fn.apply(this, args); }
        else if (!timer) { timer = setTimeout(() => { last = Date.now(); timer = null; fn.apply(this, args); }, remaining); }
    };
};

/* ==========================================================
   2. PAGINATION HELPER
   ========================================================== */
const Pagination = {
    state: { users: 1, vouchers: 1, transactions: 1, tickets: 1, message: 1 },
    pageSize: 10,

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

        return `
            <div class="pagination-controls">
                <span class="pagination-info">Page ${current} of ${totalPages}</span>
                <button ${prevDisabled} onclick="window.Pagination.changePage('${pageName}', -1, '${renderFunctionString}')"><i class="fas fa-chevron-left"></i></button>
                <button ${nextDisabled} onclick="window.Pagination.changePage('${pageName}', 1, '${renderFunctionString}')"><i class="fas fa-chevron-right"></i></button>
            </div>
        `;
    },

    changePage(pageName, direction, renderCallbackName) {
        // Simple bounds check if possible, though getPageData handles it too
        this.state[pageName] += direction;
        if (typeof window[renderCallbackName] === 'function') {
            window[renderCallbackName]();
        } else {
            console.error(`Pagination callback '${renderCallbackName}' not found.`);
        }
    }
};
window.Pagination = Pagination;
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
   3. CORDOVA SETUP & PERMISSIONS
   ========================================================== */
document.addEventListener('deviceready', onDeviceReady, false);

function onDeviceReady() {
    console.log(`Cordova Ready: ${cordova.platformId}@${cordova.version}`);

    // Always configure background mode & notifications — independent of Wi-Fi plugin
    PermissionsHelper.configureBackgroundMode();
    initializeNotificationChannel();

    if (typeof WifiWizard2 === 'undefined') {
        console.warn('WifiWizard2 plugin missing. Running in browser mode?');
        if (cordova.platformId === 'android') safeShowToast('Wi-Fi features unavailable (Plugin missing)', 'warning');
    } else {
        window.NetworkTools.initialize();
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

        // Channel creation itself lives in NotificationManager (js/03.notifications.js)
        // so there's one place that owns the channel id/importance/etc.
        if (window.NotificationManager) window.NotificationManager.setupChannel();
    }
}

const PermissionsHelper = {
    // Runtime permission groups shown in Settings > App Permissions.
    // `names` must match android:name suffixes declared in config.xml.
    // `minVersion` is the Android OS version (not API level) the group first applies to.
    GROUPS: [
        { id: 'location', label: 'Location', desc: 'Scan and auto-connect to the hotspot Wi-Fi.', names: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'] },
        { id: 'nearbyWifi', label: 'Nearby Wi-Fi Devices', desc: 'Wi-Fi scanning without Location (Android 13+).', names: ['NEARBY_WIFI_DEVICES'], minVersion: 13 },
        { id: 'camera', label: 'Camera', desc: 'Scan voucher QR codes.', names: ['CAMERA'] },
        { id: 'microphone', label: 'Microphone', desc: 'Voice input for the AI assistant.', names: ['RECORD_AUDIO'] },
        { id: 'bluetooth', label: 'Bluetooth', desc: 'Mesh/offline credit sharing with nearby devices.', names: ['BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT', 'BLUETOOTH_ADVERTISE'], minVersion: 12 },
        { id: 'notifications', label: 'Notifications', desc: 'Alerts for plan expiry and received credits.', names: ['POST_NOTIFICATIONS'], minVersion: 13 }
    ],

    _resolveName(rawName) {
        const permissions = cordova.plugins.permissions;
        return permissions[rawName] || `android.permission.${rawName}`;
    },

    // Whether this group even applies on the current OS version.
    groupApplies(group) {
        if (!group.minVersion) return true;
        if (typeof device === 'undefined' || !device.version) return true;
        return parseInt(device.version, 10) >= group.minVersion;
    },

    // 'granted' | 'denied' | 'unavailable' (not on Cordova, e.g. plain browser/PWA)
    checkGroup(groupId) {
        return new Promise((resolve) => {
            const group = this.GROUPS.find(g => g.id === groupId);
            if (!group || typeof cordova === 'undefined' || !cordova.plugins?.permissions) return resolve('unavailable');
            cordova.plugins.permissions.checkPermission(this._resolveName(group.names[0]),
                (status) => resolve(status.hasPermission ? 'granted' : 'denied'),
                () => resolve('unavailable')
            );
        });
    },

    requestGroup(groupId) {
        return new Promise((resolve) => {
            const group = this.GROUPS.find(g => g.id === groupId);
            if (!group || typeof cordova === 'undefined' || !cordova.plugins?.permissions) return resolve(false);
            const list = group.names.map(n => this._resolveName(n));
            cordova.plugins.permissions.requestPermissions(list,
                (status) => resolve(!!status.hasPermission),
                () => resolve(false)
            );
        });
    },

    async requestAll() {
        if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.permissions) return false;
        let allGranted = true;
        for (const group of this.GROUPS) {
            if (!this.groupApplies(group)) continue;
            const granted = await this.requestGroup(group.id);
            allGranted = allGranted && granted;
        }
        return allGranted;
    },

    configureBackgroundMode() {
        if (typeof cordova !== 'undefined' && cordova.plugins?.backgroundMode) {
            try {
                // Background mode settings can crash on iOS if improperly configured
                const platform = typeof device !== 'undefined' ? device.platform : 'Unknown';
                
                if (platform === 'Android') {
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
                }

                // Prevent app from sleeping
                cordova.plugins.backgroundMode.enable();
                
                if (platform === 'Android' && typeof cordova.plugins.backgroundMode.disableWebViewOptimizations === 'function') {
                    cordova.plugins.backgroundMode.disableWebViewOptimizations();
                }

                cordova.plugins.backgroundMode.on('activate', () => {
                    window.isAppPaused = true;
                    if (platform === 'Android' && typeof cordova.plugins.backgroundMode.disableWebViewOptimizations === 'function') {
                        cordova.plugins.backgroundMode.disableWebViewOptimizations();
                    }
                    console.log('🔄 Background mode active, continuing sync...');
                    if (window.OfflineOrchestrator && typeof window.OfflineOrchestrator.resume === 'function') {
                        window.OfflineOrchestrator.resume();
                    }

                    if (window.NetworkTools?.isInitialized) {
                        console.log('App in background: slowing down checks');
                        window.NetworkTools.startConnectionMonitoring(60000); // Check every minute in background
                    }
                });

                cordova.plugins.backgroundMode.on('deactivate', () => {
                    window.isAppPaused = false;
                    if (window.OfflineOrchestrator && typeof window.OfflineOrchestrator.pause === 'function') {
                        window.OfflineOrchestrator.pause();
                    }

                    if (window.NetworkTools?.isInitialized) {
                        console.log('App in foreground: monitoring active');
                        window.NetworkTools.startConnectionMonitoring(10000); // Check every 10s in foreground
                    }
                });
            } catch (e) {
                console.warn("Background Mode configuration failed:", e);
            }
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
   4. NOTIFICATION & DEVICE HELPERS
   ========================================================== */
// Every notification in the app -- native (Cordova) or Web Notification API --
// goes through window.NotificationManager (js/03.notifications.js). This is
// kept as a thin, stable-named wrapper since a lot of existing code calls
// the bare `sendNotification(title, text, id)` function directly.
function sendNotification(title, text, id) {
    if (window.NotificationManager) {
        window.NotificationManager.send({ title, text, id });
    } else {
        console.warn('[Notify] NotificationManager not loaded; dropping notification:', title);
    }
}

function cancelNotification(id) {
    if (window.NotificationManager) window.NotificationManager.cancel(id);
}

/* ==========================================================
   5. NETWORK TOOLS LOGIC
   ========================================================== */
window.NetworkTools = {
    isInitialized: false,
    connectionCheckInterval: null,
    initializationLock: false,
    isConnecting: false, // NEW: Operation lock
    lastKnownSSID: null,

    NOTIFICATION_ID_PLAN_EXPIRED: 101,
    NOTIFICATION_ID_CONNECTION_REQUIRED: 102,

    isPluginAvailable() {
        return typeof WifiWizard2 !== 'undefined';
    },

    async initialize() {
        if (this.initializationLock || this.isInitialized) return;
        this.initializationLock = true;
        Logger.info('Initializing NetworkTools...');

        try {

            // 0. Setup Permissions (Background Mode is configured once in onDeviceReady)
            await PermissionsHelper.requestAll();

            // 1. Basic WifiWizard Permission (Legacy)
            if (typeof WifiWizard2 !== 'undefined') {
                await WifiWizard2.requestPermission().catch(e => console.warn("WifiWizard2 Permission Error:", e));
            }

            const currentSSID = await this.displayConnectionInfo();

            // 2. CHECK PLAN
            if (typeof DataStore === 'undefined') {
                this.startConnectionMonitoring(); // Default to monitoring if no DataStore yet
                return;
            }

            // 2. CHECK PLAN & ROAMING BUCKET
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

            // 4. PLAN EXISTS - CONNECT OR DISCONNECT (MASTER SSID)
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
            }

            this.startConnectionMonitoring();

        } catch (err) {
            console.error('NetworkTools Init Failed:', err);
        } finally {
            this.isInitialized = true;
            this.initializationLock = false;
        }
    },

    async connectToWifi(cfg) {
        const androidVer = this.getAndroidVersion();
        try {
            if (androidVer >= 10) {
                // Android 10+ Suggestion API
                const config = { SSID: cfg.ssid, password: cfg.password, authType: "WPA", isHiddenSSID: cfg.isHiddenSSID || false };
                if (typeof WifiWizard2 !== 'undefined') {
                    if (typeof WifiWizard2.suggest === 'function') {
                        await WifiWizard2.suggest(config);
                    } else if (typeof WifiWizard2.suggestConnection === 'function') {
                        await WifiWizard2.suggestConnection(cfg.ssid, cfg.password, "WPA", cfg.isHiddenSSID || false);
                    }
                }
                safeShowToast(`"${cfg.ssid}" suggested. Tap to connect.`, 'success');
                sendNotification('Tap and Connect ', `Tap to connect to ${cfg.ssid}`, this.NOTIFICATION_ID_CONNECTION_REQUIRED);
            } else {
                // Legacy Android Connect
                safeShowToast(`Connecting to ${cfg.ssid}...`, 'info');
                if (typeof WifiWizard2 !== 'undefined') {
                    await WifiWizard2.connect(cfg.ssid, true, cfg.password, 'WPA', false);
                    safeShowToast(`Connected to ${cfg.ssid}`, 'success');
                } else {
                    console.warn("WifiWizard2 not available. Skipping connection logic.");
                }
            }
            
            // Start fast-polling to detect the exact moment the phone connects
            this.startFastPolling();
        } catch (err) {
            console.error("Connect Error", err);
        }
    },

    startFastPolling() {
        if (this.fastPollInterval) clearInterval(this.fastPollInterval);
        let attempts = 0;
        
        console.log("[NetworkTools] Starting Fast Poll (2s interval, max 30s) to detect connection...");
        this.fastPollInterval = setInterval(async () => {
            attempts++;
            await this.displayConnectionInfo();
            
            if (attempts >= 15) {
                console.log("[NetworkTools] Fast Poll finished.");
                clearInterval(this.fastPollInterval);
                this.fastPollInterval = null;
            }
        }, 2000);
    },

    async applyPoison(poisonCfg) {
        if (this.isPoisoning) return;
        this.isPoisoning = true;

        const ssid = poisonCfg.ssid;
        const badPassword = poisonCfg.password;
        const androidVer = this.getAndroidVersion();

        try {
            if (androidVer < 10) {
                if (typeof WifiWizard2 !== 'undefined') {
                    await WifiWizard2.disconnect(ssid).catch(() => { });
                    await WifiWizard2.remove(ssid).catch(() => { });
                }
                // this.isPoisoning = false; // Release lock
                return;
            }

            const poisonObj = { SSID: ssid, password: badPassword, authType: "WPA", isAppInteraction: true };

            if (typeof WifiWizard2 !== 'undefined') {
                if (typeof WifiWizard2.suggest === 'function') {
                    await WifiWizard2.suggest(poisonObj);
                } else if (typeof WifiWizard2.suggestConnection === 'function') {
                    await WifiWizard2.suggestConnection(ssid, badPassword, "WPA", false);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 1500));

            if (typeof WifiWizard2 !== 'undefined') {
                await WifiWizard2.connect(ssid, false, badPassword, "WPA", false).catch(() => { });
            }

            await new Promise(resolve => setTimeout(resolve, 4000));

            const check = await this.getCleanSSID();
            if (check === ssid) {
                safeShowToast('Please disconnect in Settings', 'warning');
                this.openWifiSettings();
            }

        } catch (e) {
            console.warn("Poison application error", e);
            this.openWifiSettings();
        } finally {
            this.isPoisoning = false;
        }
    },

    async guardHotspot() {
        try {
            if (typeof DataStore === 'undefined') return;

            // 1. Get Current SSID
            const currentSSID = await this.getCleanSSID();
            if (!currentSSID) return;

            // 2. Ask DataStore: "Am I allowed to be here?"
            const uid = currentUser ? currentUser.id : null;
            const cfg = await DataStore.getNetworkSettings(uid).catch(() => null);

            if (!cfg) return;

            // 3. Check Master SSID
            if (cfg.ssid && currentSSID === cfg.ssid) {
                if (cfg.accessGranted === false) {
                    console.warn(`[Guard] Plan expired for ${currentSSID}. Applying poison.`);
                    await this.applyPoison(cfg);
                    if (typeof navigator.vibrate === 'function') navigator.vibrate([200, 100, 200]);
                } else {
                    console.log(`[Guard] Access granted for ${currentSSID}.`);
                    cancelNotification(this.NOTIFICATION_ID_PLAN_EXPIRED);
                }
                return;
            }

            // 4. Check Partner Networks (Roaming)
            if (cfg.partnerNetworks && cfg.partnerNetworks.length > 0) {
                const connectedPartner = cfg.partnerNetworks.find(p => p.ssid === currentSSID);
                if (connectedPartner) {
                    if (cfg.accessGranted === false) {
                        console.warn('Security: Plan expired (Partner SSID).');
                        await this.applyPoison({ ssid: currentSSID, password: "EXP_" + Date.now() });
                    } else {
                        // Log connection if not already logged recently (simple debounce/last SSID check)
                        if (this.lastLoggedSSID !== currentSSID) {
                            await this.logRoamingConnection(connectedPartner);
                        }
                    }
                }
            }
        } catch (err) {
            console.error('guardHotspot error:', err);
        }
    },
    async testGuardHotspot() {
        console.log("[Test] Manually triggering Hotspot Guard...");
        await this.guardHotspot();
        showToast("Hotspot Guard Test Complete (Check Console)", "info");
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
                        isHiddenSSID: net.isHiddenSSID || false
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
            
            // --- SEAMLESS CAPTIVE PORTAL AUTO-LOGIN ---
            // Trigger auto-login exactly when the phone connects to a network.
            if (window.RouterBridge && window.currentUser && cleanSSID !== 'Not Connected') {
                const pass = window.currentUser.hotspotPass || window.currentUser.uid || window.currentUser.id;
                window.RouterBridge.autoLogin(window.currentUser.username, pass).catch(()=>{});
            }
            
            // If fast polling is active, the connection succeeded, so we can stop it early
            if (this.fastPollInterval) {
                clearInterval(this.fastPollInterval);
                this.fastPollInterval = null;
                console.log("[NetworkTools] Connection detected. Fast poll stopped early.");
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

    startConnectionMonitoring(intervalMs = 60000) {
        this.stopConnectionMonitoring();
        if (typeof WifiWizard2 === 'undefined') return;

        this.isPoisoning = false; // Add lock flag

        this.connectionCheckInterval = setInterval(async () => {
            if (this.isPoisoning) return; // Skip if busy
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

    getAndroidVersion() {
        if (typeof device === 'undefined') return 0;
        return (device.platform === 'Android') ? Math.floor(Number(device.version) || 0) : 0;
    },

    openWifiSettings() {
        if (typeof cordova !== 'undefined' && cordova.plugins?.settings) {
            cordova.plugins.settings.open("wifi");
        }
    },

    /* ==========================================================
       VBB (Volume-Variable Billing) - Traffic Accounting
       ========================================================== */
    startTrafficAccounting(intervalMs = 60000) {
        if (this.trafficInterval) clearInterval(this.trafficInterval);

        this.trafficInterval = setInterval(async () => {
            if (!currentUser || !navigator.onLine) return;

            const sub = getActiveSubscription();
            if (!sub || sub.dataLimit === 0) return;

            // -- Query REAL traffic from MikroTik, fall back to conservative estimate --
            let deltaMB = 0;

            if (window.RouterBridge) {
                try {
                    // Ensure connection is active
                    if (!window.RouterBridge.isConnected()) {
                        await window.RouterBridge.connect();
                    }
                    const username = currentUser.username || currentUser.id;
                    const usage = await window.RouterBridge.getUserStats(username);
                    if (usage && typeof usage.totalMB === 'number') {
                        // Calculate delta since last known value
                        const lastMB = this._lastKnownMB || 0;
                        deltaMB = Math.max(0, usage.totalMB - lastMB);
                        this._lastKnownMB = usage.totalMB;
                        console.log(`[VBB] Real MikroTik traffic: ${usage.totalMB.toFixed(2)}MB total, delta: ${deltaMB.toFixed(2)}MB`);
                    }
                } catch (e) {
                    console.warn('[VBB] MikroTik query failed, using fallback estimate:', e.message);
                    deltaMB = 1; // conservative 1MB/min fallback
                }
            } else {
                deltaMB = 1; // no bridge available — conservative estimate
            }

            if (deltaMB === 0) return; // no new usage, skip Firestore write
            const deltaGB = deltaMB / 1024;

            try {
                const userRef = db.collection('users').doc(currentUser.id);
                const userDoc = await userRef.get();
                if (!userDoc.exists) return;

                const subs = userDoc.data().subscriptions || [];
                const updatedSubs = subs.map(s => {
                    if (s.id === sub.id) {
                        return { ...s, dataConsumed: (s.dataConsumed || 0) + deltaGB };
                    }
                    return s;
                });

                await userRef.update({ subscriptions: updatedSubs });

                if ((sub.dataConsumed + deltaGB) >= sub.dataLimit) {
                    console.warn("[VBB] Data ceiling reached. Enforcing policy.");
                    this.guardHotspot();
                }
            } catch (e) { console.warn("[VBB] Sync Error:", e); }
        }, intervalMs);
    },

    stopTrafficAccounting() {
        if (this.trafficInterval) {
            clearInterval(this.trafficInterval);
            this.trafficInterval = null;
        }
    },

    /* ==========================================================
       Partner Roaming Verification Test
       ========================================================== */


    async testPartnerRoamingFlow() {
        console.log("[PartnerDiagnostics] Starting End-to-End Partner Flow Diagnostic...");

        const dummyPartner = {
            id: 'test-node-123',
            partnerId: 'test-partner-001',
            ssid: 'Power-Partner-HQ',
            password: 'PartnerSecurePass'
        };

        showToast("Running Partner Roaming Diagnostics...", "info");

        console.log("[Diagnostics] Verification Step 1: Logging connection...");
        await this.logRoamingConnection(dummyPartner);

        console.log("[Diagnostics] Verification Step 2: Triggering Guard check...");
        const originalGetSSID = this.getCleanSSID;
        this.getCleanSSID = async () => dummyPartner.ssid;

        await this.guardHotspot();

        console.log("[Diagnostics] Verification Step 3: Triggering VBB Accounting Jump...");
        await this.startTrafficAccounting(1000);
        showToast("Partner & VBB Diagnostics Complete", "success");
        this.getCleanSSID = originalGetSSID;
    },

    performSecurityCheck() {
        return this.guardHotspot();
    },

    cleanup() {
        this.stopConnectionMonitoring();
        this.stopTrafficAccounting();
        cancelNotification(this.NOTIFICATION_ID_PLAN_EXPIRED);
        cancelNotification(this.NOTIFICATION_ID_CONNECTION_REQUIRED);
        this.initializationLock = false;
    },

    /* ==========================================================
       VoIP Integration (User Request)
       ========================================================== */
    call(targetId) {
        if (typeof VoIPManager !== 'undefined') {
            VoIPManager.initCall('audio', targetId);
        } else {
            console.error("VoIPManager not loaded");
        }
    },

    video(targetId) {
        if (typeof VoIPManager !== 'undefined') {
            VoIPManager.initCall('video', targetId);
        } else {
            console.error("VoIPManager not loaded");
        }
    },

    /* ==========================================================
       AI INTEGRATION: Feed Network State to Nano-AI
       ========================================================== */
    async feedAI() {
        if (!window.ContextManager) return null;

        const networkState = {
            ssid: await this.getCleanSSID(),
            isInitialized: this.isInitialized,
            connectionQuality: navigator.onLine ? 'good' : 'offline',
            lastCheck: Date.now()
        };

        // Store for AI context gathering
        if (window.ContextManager.updateNetworkState) {
            window.ContextManager.updateNetworkState(networkState);
        }

        return networkState;
    },

    // Auto-feed AI every 30 seconds
    startAIFeed() {
        if (this.aiFeedInterval) clearInterval(this.aiFeedInterval);
        this.aiFeedInterval = setInterval(() => this.feedAI(), 30000);
    }
};
/* ==========================================================
   6. DEVICE INFO CAPTURE
   ========================================================== */
window.captureLocalDeviceInfo = async () => {
    if (!window.currentUser || typeof db === 'undefined') return;

    try {
        const telemetry = {
            lastIP: 'Unknown',
            lastSSID: null,
            deviceModel: 'Unknown',
            platform: 'Web',
            deviceId: 'Unknown',
            osVersion: 'Unknown',
            appVersion: '2025.12.27',
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        };

        // Network info
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

        // Feed telemetry to AI
        if (window.ContextManager && window.ContextManager.updateTelemetry) {
            window.ContextManager.updateTelemetry(telemetry);
            console.log('[Telemetry] Fed to AI context');
        }

    } catch (e) {
        console.warn('[Telemetry] Update failed:', e);
    }
};

/* ==========================================================
   7. OFFLINE QUEUE UI INDICATOR
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

    indicator.innerHTML = `
        <i class="fas fa-cloud-upload-alt"></i>
        ${status.pending} pending sync
    `;

    indicator.style.display = 'flex';
}

// Update indicator periodically
let offlineQueueInterval = setInterval(renderOfflineQueueIndicator, 5000);

/* ==========================================================
   8. NETWORK STATUS MONITORING
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
   9. APP LIFECYCLE EVENTS
   ========================================================== */
document.addEventListener('pause', () => {
    if (window.NetworkTools) window.NetworkTools.stopConnectionMonitoring();
}, false);

document.addEventListener('resume', () => {
    if (window.NetworkTools && window.NetworkTools.isInitialized) {
        window.NetworkTools.startConnectionMonitoring(10000);
        window.NetworkTools.displayConnectionInfo();
        window.NetworkTools.performSecurityCheck();
    }
}, false);

window.addEventListener('beforeunload', () => {
    if (window.NetworkTools) window.NetworkTools.cleanup();
});
/* ==========================================================
   10. INITIALIZE OFFLINE STATUS BADGE
   ========================================================== */
document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.onLine) {
        const badge = document.getElementById('offlineBadge');
        if (badge) badge.classList.add('active');
    }
});
