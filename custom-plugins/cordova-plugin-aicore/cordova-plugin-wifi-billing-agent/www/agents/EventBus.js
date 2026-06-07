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
        },

        _getListeners: function() {
            return listeners;
        }
    };
})();

if (typeof window !== 'undefined') {
    if (window.EventBus && typeof window.EventBus._getListeners === 'function') {
        var oldListeners = window.EventBus._getListeners();
        for (var ev in oldListeners) {
            if (oldListeners.hasOwnProperty(ev)) {
                oldListeners[ev].forEach(function(cb) {
                    EventBus.on(ev, cb);
                });
            }
        }
    }
    window.EventBus = EventBus;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventBus;
}
