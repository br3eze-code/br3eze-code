/**
 * CryptoUtils - Simple frontend hashing and signatures
 */
var CryptoUtils = (function() {
    return {
        hash: function(input) {
            // In production, use Web Crypto API or a library
            return btoa(input);
        }
    };
})();

if (typeof window !== 'undefined') {
    window.CryptoUtils = CryptoUtils;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CryptoUtils;
}
