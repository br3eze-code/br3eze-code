/**
 * WiFiAgent - Manages WiFi connections and scanning
 */
var WiFiAgent = (function() {
    var core = null;

    return {
        initialize: function(coreAgent) {
            core = coreAgent;
            core.registerAgent('wifi', this);
        },

        scan: function(options, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'scan', [options]);
        },

        connect: function(ssid, password, options, success, error) {
            var params = options || {};
            params.ssid = ssid;
            params.password = password;
            cordova.exec(success, error, 'WiFiBillingAgent', 'connect', [params]);
        },

        disconnect: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'disconnect', [{}]);
        },

        getConnectionInfo: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'getConnectionInfo', []);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.WiFiAgent = WiFiAgent;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WiFiAgent;
}
