/**
 * BillingAgent - Manages billing sessions and data usage
 */
var BillingAgent = (function() {
    var core = null;

    return {
        initialize: function(coreAgent) {
            core = coreAgent;
            core.registerAgent('billing', this);
        },

        startSession: function(options, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'startBillingSession', [options]);
        },

        getSessionStatus: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'getSessionStatus', []);
        },

        getDataUsage: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'getDataUsage', []);
        },

        pauseSession: function(reason, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'pauseSession', [reason]);
        },

        resumeSession: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'resumeSession', []);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.BillingAgent = BillingAgent;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BillingAgent;
}
