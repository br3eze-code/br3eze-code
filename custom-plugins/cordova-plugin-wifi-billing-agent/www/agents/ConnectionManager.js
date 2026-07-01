/**
 * ConnectionManager - Manages WiFi connection lifecycle
 */
var ConnectionManager = (function() {
    var core = null;

    return {
        initialize: function(coreAgent) {
            core = coreAgent;
            core.registerAgent('connection', this);
        },

        connect: function(ssid, password, options, success, error) {
            // Logic for managing connection retries, state etc.
            var wifi = core.getAgent('wifi');
            if (wifi) {
                wifi.connect(ssid, password, options, success, error);
            } else {
                if (error) error('WiFiAgent not found');
            }
        }
    };
})();

if (typeof window !== 'undefined') {
    window.ConnectionManager = ConnectionManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConnectionManager;
}
