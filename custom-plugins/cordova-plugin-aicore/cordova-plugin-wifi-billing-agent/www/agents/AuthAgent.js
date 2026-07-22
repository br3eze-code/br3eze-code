/**
 * AuthAgent - Manages authentication and tokens
 */
var AuthAgent = (function () {
    var core = null;

    return {
        initialize: function (coreAgent) {
            core = coreAgent;
            core.registerAgent('auth', this);
        },

        authenticate: function (credentials, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'authenticate', [credentials]);
        },

        validateToken: function (token, success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'validateToken', [token]);
        },

        refreshToken: function (success, error) {
            cordova.exec(success, error, 'WiFiBillingAgent', 'refreshToken', []);
        }
    };
})();
if (typeof window !== 'undefined') {
    window.AuthAgent = AuthAgent;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthAgent;
}
