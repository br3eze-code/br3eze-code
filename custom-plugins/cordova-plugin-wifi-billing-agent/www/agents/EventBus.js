/**
 * EventBus - Simple pub/sub for agent communication
 */
var EventBus = (function() {
    var listeners = {};

    return {
        on: function(event, callback) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(callback);
        },

        emit: function(event, data) {
            if (listeners[event]) {
                listeners[event].forEach(function(callback) {
                    try {
                        callback(data);
                    } catch (e) {
                        console.error('EventBus: Error in callback for ' + event, e);
                    }
                });
            }
        },

        off: function(event, callback) {
            if (!listeners[event]) return;
            listeners[event] = listeners[event].filter(function(cb) {
                return cb !== callback;
            });
        }
    };
})();

if (typeof window !== 'undefined') {
    window.EventBus = EventBus;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventBus;
}
