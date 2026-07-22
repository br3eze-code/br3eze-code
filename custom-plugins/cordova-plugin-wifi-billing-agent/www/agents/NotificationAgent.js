/**
 * NotificationAgent - Manages user alerts and notifications
 */
var NotificationAgent = (function() {
    var core = null;

    return {
        initialize: function(coreAgent) {
            core = coreAgent;
            core.registerAgent('notification', this);
        },

        sendNotification: function(notification, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'sendNotification', [notification]);
        },

        clearNotification: function(id, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'clearNotification', [id]);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.NotificationAgent = NotificationAgent;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotificationAgent;
}
