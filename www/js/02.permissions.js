/* ==========================================================
   02.permissions.js — Runtime permission manager
   Depends on: 01.ui.utils.js (showToast)
   Handles four groups:
     LOCATION  – ACCESS_FINE_LOCATION (Android 6-11)
     NEARBY    – NEARBY_WIFI_DEVICES  (Android 12+)
     NOTIFY    – POST_NOTIFICATIONS   (Android 13+)
     SUGGEST   – canSuggest() guard before suggestConnection()
   Rules:
     ✓ Only DANGEROUS perms passed to requestPermissions()
       (install-time: WIFI_STATE, INTERNET etc. live in manifest only)
     ✓ requestPermissions returns ONE {hasPermission} bool — handled correctly
     ✓ Every path has try/catch — nothing crashes the system
     ✓ Resume: silent re-check, throttled to once/30 s, no repeated dialogs
     ✓ Permanent denial: deep-link to App Settings, no infinite loop
   ========================================================== */

window.PermissionManager = (function () {

    let _ver         = 0;
    let _initialized = false;
    let _lastCheck   = 0;

    // ── Helpers ─────────────────────────────────────────────
    function _plug() {
        try {
            _ver = typeof device !== 'undefined' ? (parseInt(device.version) || 0) : 0;
            return typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.androidPermissions;
        } catch(e) {
            return null;
        }
    }

    function _request(perms) {
        return new Promise(resolve => {
            if (!perms.length) return resolve(true);
            const p = _plug();
            if (!p) return resolve(true);
            try {
                p.requestPermissions(
                    perms,
                    result => resolve(result?.hasPermission === true),
                    ()     => resolve(false)
                );
            } catch (e) {
                console.warn('[PermMgr] requestPermissions threw:', e);
                resolve(false);
            }
        });
    }

    function _check(perm) {
        return new Promise(resolve => {
            const p = _plug();
            if (!p) return resolve(true);
            try {
                p.checkPermission(perm, r => resolve(r?.hasPermission === true), () => resolve(false));
            } catch (e) { resolve(false); }
        });
    }

    function _openSettings(label) {
        window.showToast(`"${label}" denied — enable it in App Settings.`, 'warning');
        setTimeout(() => {
            try { _plug()?.showAppDetailsSettings?.(); } catch (e) {}
        }, 2000);
    }

    // ── GROUP: Location (Android 6–11 + Web) ───────────────────────
    async function requestLocation() {
        if (_ver >= 12 && typeof cordova !== 'undefined') return true; // NEARBY covers Wi-Fi on 12+
        const p = _plug();
        if (!p) {
            // Web API Fallback: Skip location on Desktop Web to prevent hanging
            return true;
        }
        const ok = await _request([p.ACCESS_FINE_LOCATION, p.ACCESS_COARSE_LOCATION]);
        if (!ok) _openSettings('Location');
        return ok;
    }

    // ── GROUP: Nearby Wi-Fi Devices (Android 12+) ────────────
    async function requestNearby() {
        if (_ver < 12) return true;
        const p = _plug();
        if (!p) return true;
        // Both NEARBY_WIFI_DEVICES + FINE_LOCATION needed on some OEM ROMs
        const ok = await _request([p.NEARBY_WIFI_DEVICES, p.ACCESS_FINE_LOCATION]);
        if (!ok) _openSettings('Nearby Wi-Fi Devices');
        return ok;
    }

    // ── GROUP: Notifications (Android 13+ + Web) ───────────────────
    async function requestNotifications() {
        const p = _plug();
        if (!p) {
            // Web API Fallback
            if ('Notification' in window && Notification.permission !== 'granted') {
                return new Promise(resolve => {
                    const t = setTimeout(() => resolve(true), 5000); // don't freeze
                    Notification.requestPermission().then(perm => {
                        clearTimeout(t);
                        resolve(perm === 'granted');
                    }).catch(() => resolve(true));
                });
            }
            return true;
        }
        if (_ver < 13) return true;
        const ok = await _request([p.POST_NOTIFICATIONS]);
        if (!ok) console.warn('[PermMgr] Notifications denied — toasts only, non-fatal.');
        return ok; // non-fatal: app works fine without it
    }

    // ── GROUP: Suggest guard (call before suggestConnection) ──
    async function canSuggest() {
        if (_ver < 10) return true; // suggestConnection only used on Android 10+
        const p = _plug();
        if (!p) return true;
        return _ver >= 12
            ? _check(p.NEARBY_WIFI_DEVICES)
            : _check(p.ACCESS_FINE_LOCATION);
    }

    // ── Master init ──────────────────────────────────────────
    async function initialize() {
        try {
            _ver         = parseInt(device?.version) || 0;
            _initialized = true;
            _lastCheck   = Date.now();

            await requestLocation();
            await requestNearby();
            await requestNotifications();

            // Let WifiWizard2 run its own internal permission check
            if (typeof WifiWizard2 !== 'undefined' &&
                typeof WifiWizard2.requestPermission === 'function') {
                await WifiWizard2.requestPermission()
                    .catch(e => console.warn('[PermMgr] WifiWizard2.requestPermission:', e));
            }
        } catch (e) {
            console.error('[PermMgr] initialize error (non-fatal):', e);
        }
    }

    // ── Resume re-check: silent, throttled ───────────────────
    async function onResume() {
        if (!_initialized) return;
        if (Date.now() - _lastCheck < 30000) return; // max once/30 s
        _lastCheck = Date.now();
        try {
            // Build runtime-only list again
            const p   = _plug();
            if (!p) return;
            const list = [];
            if (_ver >= 6  && _ver < 12) { list.push(p.ACCESS_FINE_LOCATION, p.ACCESS_COARSE_LOCATION); }
            if (_ver >= 12) { list.push(p.NEARBY_WIFI_DEVICES, p.ACCESS_FINE_LOCATION); }
            if (_ver >= 13) { list.push(p.POST_NOTIFICATIONS); }
            await _request(list); // OS will NOT show dialog if already granted
        } catch (e) {
            console.warn('[PermMgr] onResume check error (non-fatal):', e);
        }
    }

    return { initialize, requestLocation, requestNearby, requestNotifications, canSuggest, onResume };

}());
