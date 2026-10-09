/* Domain-neutral Cordova connectivity facade.
 * Legacy WiFiBillingAgent remains available for compatibility; new callers use
 * this contract and do not need to know the application domain.
 */
(function (global) {
    'use strict';

    function native(action, args) {
        return new Promise(function (resolve, reject) {
            if (typeof cordova === 'undefined') {
                reject({ code: 'NATIVE_BRIDGE_UNAVAILABLE', action: action });
                return;
            }
            try {
                require('cordova/exec')(resolve, reject, 'WiFiBillingAgent', action, args || []);
            } catch (e) { reject(e); }
        });
    }

    var bridge = {
        version: '1.0.1',
        capabilities: [
            'connect', 'disconnect', 'scan', 'suggestConnection',
            'getConnectionInfo', 'isWifiEnabled',
            'canConnectToInternet', 'canConnectToRouter'
        ],
        connect: function (connection) { return native('connect', [connection || {}]); },
        disconnect: function (options) { return native('disconnect', [options || {}]); },
        scan: function (options) { return native('scan', [options || {}]); },
        suggestConnection: function (request) { return native('suggestConnection', [request || {}]); },
        getConnectionInfo: function () { return native('getConnectionInfo'); },
        isWifiEnabled: function () { return native('isWifiEnabled'); },
        canConnectToInternet: function () { return native('canConnectToInternet'); },
        canConnectToRouter: function () { return native('canConnectToRouter'); },
        getNetworkDiagnostics: async function () {
            var values = await Promise.allSettled([
                this.getConnectionInfo(),
                this.isWifiEnabled(),
                this.canConnectToInternet(),
                this.canConnectToRouter()
            ]);
            return {
                connection: values[0].status === 'fulfilled' ? values[0].value : null,
                wifiEnabled: values[1].status === 'fulfilled' ? values[1].value : null,
                internetReachable: values[2].status === 'fulfilled' ? values[2].value : null,
                routerReachable: values[3].status === 'fulfilled' ? values[3].value : null
            };
        },
        deviceContext: function () {
            return {
                platform: global.device?.platform || 'unknown',
                version: global.device?.version || null,
                manufacturer: global.device?.manufacturer || null,
                model: global.device?.model || null
            };
        }
    };

    global.AgentOSConnectivity = bridge;
    global.cordova = global.cordova || {};
    global.cordova.plugins = global.cordova.plugins || {};
    global.cordova.plugins.AgentOSConnectivity = bridge;
})(window);
