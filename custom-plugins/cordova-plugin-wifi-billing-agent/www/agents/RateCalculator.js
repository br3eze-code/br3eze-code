/**
 * RateCalculator - Calculates billing costs based on usage
 */
var RateCalculator = (function() {
    return {
        calculate: function(usage, rate) {
            return usage * rate;
        }
    };
})();

if (typeof window !== 'undefined') {
    window.RateCalculator = RateCalculator;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RateCalculator;
}
