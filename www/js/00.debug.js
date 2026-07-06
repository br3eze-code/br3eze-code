/* ==========================================================
   00.debug.js — Debug logger, global error boundary
   Load FIRST (before all other modules).
   Strips all output in production if window.DEBUG = false.
   ========================================================== */

window.DEBUG = true; // Set false for release builds

window.Log = (function () {
    const PREFIX = '[PC]';
    const LEVELS = { info: 'color:#4fc3f7', warn: 'color:#ffb74d', error: 'color:#ef5350', ok: 'color:#81c784' };

    function _out(level, tag, ...args) {
        if (!window.DEBUG && level !== 'error') return;
        const style = LEVELS[level] || '';
        console[level === 'ok' ? 'log' : level](
            `%c${PREFIX}[${tag}]`, style, ...args
        );
    }

    return {
        info:  (tag, ...a) => _out('info',  tag, ...a),
        warn:  (tag, ...a) => _out('warn',  tag, ...a),
        error: (tag, ...a) => _out('error', tag, ...a),
        ok:    (tag, ...a) => _out('ok',    tag, ...a),
    };
}());

// ── Global uncaught error boundary ─────────────────────────
window.addEventListener('error', e => {
    window.Log.error('GLOBAL', e.message, 'at', e.filename + ':' + e.lineno);
    // Never crash the app for non-fatal errors
    // showToast is not available this early — use console only
});

window.addEventListener('unhandledrejection', e => {
    window.Log.error('PROMISE', e.reason);
    e.preventDefault(); // Prevent Cordova WebView from showing a crash dialog
});

// ── Cordova-specific diagnostics ───────────────────────────
document.addEventListener('deviceready', () => {
    if (!window.DEBUG) return;
    window.Log.ok('DEVICE', `Platform: ${cordova.platformId}`);
    window.Log.ok('DEVICE', `Android: ${device?.version || 'N/A'}`);
    window.Log.ok('DEVICE', `Model: ${device?.model || 'N/A'}`);
    window.Log.ok('DEVICE', `UUID: ${device?.uuid || 'N/A'}`);
    window.Log.ok('DEVICE', `Cordova: ${device?.cordova || 'N/A'}`);
}, false);
