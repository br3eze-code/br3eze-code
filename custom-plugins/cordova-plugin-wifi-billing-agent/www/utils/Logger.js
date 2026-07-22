/**
 * Logger - Standardized logging for agents
 */
var Logger = (function() {
    return {
        log: function(msg, data) {
            console.log('[AGENT] ' + msg, data || '');
        },
        error: function(msg, err) {
            console.error('[AGENT ERROR] ' + msg, err || '');
        }
    };
})();

if (typeof window !== 'undefined') {
    window.Logger = Logger;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}
