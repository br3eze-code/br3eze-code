/**
 * NetworkScanner - Manages WiFi network scanning and filtering
 */
var NetworkScanner = (function() {
    var core = null;

    return {
        initialize: function(coreAgent) {
            core = coreAgent;
            core.registerAgent('scanner', this);
        },

        scan: function(options, success, error) {
            var wifi = core.getAgent('wifi');
            if (wifi) {
                wifi.scan(options, success, error);
            } else {
                if (error) error('WiFiAgent not found');
            }
        }
    };
})();

if (typeof window !== 'undefined') {
    window.NetworkScanner = NetworkScanner;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkScanner;
}
