/* ==========================================================
   05.cordova.boot.js — deviceready, pause, resume handlers
   Depends on: 02.permissions.js, 03.notifications.js,
               04.network.tools.js
   ========================================================== */

document.addEventListener('deviceready', _onDeviceReady, false);

async function _onDeviceReady() {
    console.log(`[Boot] Cordova ready — platform: ${cordova.platformId}`);

    // 1. Notification channel (Android 8+ only, fully guarded)
    window.NotificationManager.setupChannel();

    // 2. Runtime permissions — Android only
    if (device?.platform === 'Android') {
        await window.PermissionManager.initialize();
    } else {
        console.warn('[Boot] Non-Android platform — permission manager skipped.');
    }

    // 3. Start Wi-Fi monitoring
    window.NetworkTools.initialize();
}

// ── App lifecycle ───────────────────────────────────────────

document.addEventListener('pause', () => {
    try { window.NetworkTools.cleanup(); }
    catch (e) { console.warn('[Boot] pause cleanup error (non-fatal):', e); }
}, false);

document.addEventListener('resume', () => {
    // Restart SSID polling
    try { window.NetworkTools.startMonitoring(); }
    catch (e) { console.warn('[Boot] resume monitor error (non-fatal):', e); }

    // Silent permission re-check — handles Android 11+ auto-reset
    try { window.PermissionManager.onResume(); }
    catch (e) { console.warn('[Boot] resume permission check error (non-fatal):', e); }
}, false);
