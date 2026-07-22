/**
 * StateManager - Frontend state persistence
 */
var StateManager = (function() {
    return {
        save: function(key, data) {
            localStorage.setItem(key, JSON.stringify(data));
        },
        get: function(key) {
            var val = localStorage.getItem(key);
            return val ? JSON.parse(val) : null;
        }
    };
})();

if (typeof window !== 'undefined') {
    window.StateManager = StateManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StateManager;
}
