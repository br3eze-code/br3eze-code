/**
 * UsageTracker - Tracks data and time usage for billing
 */
var UsageTracker = (function() {
    return {
        getStats: function(success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'getDataUsage', []);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.UsageTracker = UsageTracker;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UsageTracker;
}
