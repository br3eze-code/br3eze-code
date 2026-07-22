/* ==========================================================
   04.network.tools.js — Wi-Fi connect / disconnect / monitor
   Depends on: 01.ui.utils.js, 02.permissions.js
   Plugin: community-cordova-plugin-wifi-wizard v3.4.0
   ========================================================== */

window.NetworkTools = {
    isInitialized: false,
    interval:      null,
    lastKnownSSID: null,

    // ── Start SSID monitoring ───────────────────────────────
    initialize() {
        if (typeof WifiWizard2 === 'undefined') return;
        this.isInitialized = true;
        this.startMonitoring();
    },

    // ── Poll current connected SSID ─────────────────────────
    async displayConnectionInfo() {
        if (typeof WifiWizard2 === 'undefined') return null;
        try {
            const raw  = await WifiWizard2.getConnectedSSID();
            const ssid = typeof raw === 'string' ? raw.replace(/"/g, '') : null;
            this.lastKnownSSID = (ssid === '<unknown ssid>' || !ssid) ? null : ssid;
            return this.lastKnownSSID;
        } catch (e) {
            // Swallowed — fires when Wi-Fi is off or permission has lapsed
            return null;
        }
    },

    // ── Connect to a network ────────────────────────────────
    async connectToWifi(cfg) {
        if (typeof WifiWizard2 === 'undefined') return;

        try {
            const ver = parseInt(device?.version) || 0;

            if (device?.platform === 'Android' && ver >= 10) {
                // ── Android 10+: suggestConnection (v3.4.0 API) ─────────
                const allowed = await window.PermissionManager.canSuggest();
                if (!allowed) {
                    window.showToast('Wi-Fi permission required — check App Settings.', 'error');
                    return;
                }
                await WifiWizard2.suggestConnection(cfg.ssid, cfg.password, 'WPA', false);
                window.showToast('Network suggested — confirm in Wi-Fi settings.', 'success');

            } else {
                // ── Android <10: direct connect ──────────────────────────
                await WifiWizard2.connect(cfg.ssid, true, cfg.password, 'WPA', false);
                window.showToast('Connected to ' + cfg.ssid, 'success');
            }
        } catch (e) {
            console.error('[NetworkTools] connectToWifi error:', e);
            window.showToast('Connection failed: ' + e, 'error');
        }
    },

    // ── Disconnect / remove a network ───────────────────────
    async disconnect(ssid) {
        if (typeof WifiWizard2 === 'undefined') return;
        try {
            const ver = parseInt(device?.version) || 0;

            if (device?.platform === 'Android' && ver >= 10) {
                // Release suggestion first (Android 10+)
                if (typeof WifiWizard2.releaseNetwork === 'function') {
                    await WifiWizard2.releaseNetwork(ssid).catch(() => {});
                }
                await WifiWizard2.remove(ssid).catch(() => {});
            } else {
                await WifiWizard2.disconnect(ssid).catch(() => {});
                await WifiWizard2.remove(ssid).catch(() => {});
            }
        } catch (e) {
            console.warn('[NetworkTools] disconnect error (non-fatal):', e);
        }
    },

    // ── Polling interval ────────────────────────────────────
    startMonitoring() {
        if (this.interval) clearInterval(this.interval);
        this.interval = setInterval(async () => {
            try { await this.displayConnectionInfo(); }
            catch (e) { console.warn('[NetworkTools] monitor tick error (non-fatal):', e); }
        }, 10000);
    },

    cleanup() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
};
