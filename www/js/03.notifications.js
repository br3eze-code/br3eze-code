/* ==========================================================
   03.notifications.js — Local notification channel setup
   Depends on: nothing (cordova-plugin-local-notification)
   ========================================================== */

window.NotificationManager = {

    /**
     * Create the Wi-Fi alert channel on Android 8+.
     * importance: 4 = HIGH (avoids OEM crashes from URGENT/5)
     * Fully guarded — never crashes if plugin is missing.
     */
    setupChannel() {
        try {
            const notif = cordova?.plugins?.notification?.local;
            if (!notif) return;
            if (device?.platform !== 'Android') return;
            if (parseInt(device?.version) < 8) return;
            if (typeof notif.createChannel !== 'function') return;

            notif.createChannel(
                {
                    id:          'power_connect_alerts',
                    name:        'Wi-Fi Access Alerts',
                    description: 'Hotspot connection status notifications',
                    importance:  4,       // HIGH — safe on all OEMs
                    sound:       'default',
                    vibrate:     true,
                    lights:      true,
                    badge:       true,
                },
                ()  => console.log('[Notify] Channel created OK.'),
                err => console.warn('[Notify] createChannel non-fatal error:', err)
            );
        } catch (e) {
            console.warn('[Notify] setupChannel error (non-fatal):', e);
        }
    },

    /**
     * Schedule a local notification safely.
     * @param {object} opts  — title, text, id (optional)
     */
    send(opts = {}) {
        try {
            const notif = cordova?.plugins?.notification?.local;
            if (!notif || typeof notif.schedule !== 'function') {
                // Web API fallback
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification(opts.title || 'Power Connect', {
                        body: opts.text || '',
                        icon: 'img/logo.png'
                    });
                }
                return;
            }

            notif.schedule({
                id:      opts.id      || Date.now(),
                title:   opts.title   || 'Power Connect',
                text:    opts.text    || '',
                channel: 'power_connect_alerts',
                badge:   1,
                foreground: true,
            });
        } catch (e) {
            console.warn('[Notify] send error (non-fatal):', e);
        }
    },

    /**
     * Cancel a scheduled notification by id.
     */
    cancel(id) {
        try {
            const notif = cordova?.plugins?.notification?.local;
            if (notif && typeof notif.cancel === 'function') notif.cancel(id);
        } catch (e) {}
    }
};
