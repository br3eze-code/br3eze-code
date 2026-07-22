/**
 * NetworkUtils - Helper for frontend network info
 */
var NetworkUtils = (function() {
    return {
        isOnline: function() {
            return navigator.onLine;
        }
    };
})();

if (typeof window !== 'undefined') {
    window.NetworkUtils = NetworkUtils;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkUtils;
}
