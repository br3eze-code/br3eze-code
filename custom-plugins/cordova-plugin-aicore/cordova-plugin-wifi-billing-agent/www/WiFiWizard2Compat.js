/**
 * WiFiWizard2 Compatibility Layer
 * Provides 100% backward compatibility with existing WiFiWizard2 code
 * while adding billing agent capabilities
 * @version 4.1.0
 */

var exec = require('cordova/exec');

/**
 * WiFiWizard2 Compatibility API
 * Drop-in replacement for cordova-plugin-wifiwizard2
 */
var WifiWizard2 = {
    
    // Version info
    VERSION: '4.1.0',
    
    /**
     * Check if WiFi is enabled
     * @returns {Promise<boolean>}
     */
    isWifiEnabled: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'isWifiEnabled', []);
        });
    },
    
    /**
     * Enable/disable WiFi
     * @param {boolean} enabled
     * @returns {Promise<void>}
     */
    setWifiEnabled: function(enabled) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'setWifiEnabled', [enabled]);
        });
    },
    
    /**
     * Connect to WiFi with WiFiWizard2 signature
     * @param {string} ssid
     * @param {boolean} bindAll
     * @param {string} password
     * @param {string} algorithm
     * @param {boolean} isHiddenSSID
     * @returns {Promise<string>}
     */
    connect: function(ssid, bindAll, password, algorithm, isHiddenSSID) {
        return new Promise(function(resolve, reject) {
            var params = [
                ssid,
                bindAll ? "true" : "false",
                "false" // waitForConnection
            ];
            exec(resolve, reject, 'WiFiBillingAgent', 'connect', params);
        });
    },
    
    /**
     * Enhanced connect with all WiFiWizard2 options
     * @param {string} ssid
     * @param {boolean} bindAll
     * @param {boolean} waitForConnection
     * @param {string} password
     * @param {string} algorithm
     * @param {boolean} isHiddenSSID
     * @returns {Promise<string>}
     */
    connectAsync: function(ssid, bindAll, waitForConnection, password, algorithm, isHiddenSSID) {
        return new Promise(function(resolve, reject) {
            var params = [
                ssid,
                bindAll ? "true" : "false",
                waitForConnection ? "true" : "false"
            ];
            exec(resolve, reject, 'WiFiBillingAgent', 'connect', params);
        });
    },
    
    /**
     * Android 10+ specifier connection (WiFiWizard2 3.1.0+)
     * @param {string} ssid
     * @param {string} password
     * @param {string} algorithm
     * @param {boolean} isHiddenSSID
     * @returns {Promise<void>}
     */
    specifierConnection: function(ssid, password, algorithm, isHiddenSSID) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'specifierConnection', [
                ssid, password || "", algorithm || "NONE", isHiddenSSID || false
            ]);
        });
    },
    
    /**
     * Android 10+ suggestion connection (WiFiWizard2 3.1.0+)
     * @param {string} ssid
     * @param {string} password
     * @param {string} algorithm
     * @param {boolean} isHiddenSSID
     * @returns {Promise<string>}
     */
    suggestConnection: function(ssid, password, algorithm, isHiddenSSID, shareWithUser, isUntrusted) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'suggestConnection', [
                ssid, password || "", algorithm || "NONE", isHiddenSSID || false,
                shareWithUser !== undefined ? shareWithUser : true,
                isUntrusted || false
            ]);
        });
    },
    
    /**
     * Disconnect from current network
     * @returns {Promise<string>}
     */
    disconnect: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'disconnect', []);
        });
    },
    
    /**
     * Disconnect from specific network
     * @param {string} ssid
     * @returns {Promise<string>}
     */
    disconnectNetwork: function(ssid) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'disconnectNetwork', [ssid]);
        });
    },
    
    /**
     * Get connected SSID
     * @returns {Promise<string>}
     */
    getConnectedSSID: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getConnectedSSID', []);
        });
    },
    
    /**
     * Get connected BSSID
     * @returns {Promise<string>}
     */
    getConnectedBSSID: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getConnectedBSSID', []);
        });
    },
    
    /**
     * Get connected network ID
     * @returns {Promise<number>}
     */
    getConnectedNetworkID: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getConnectedNetworkID', []);
        });
    },
    
    /**
     * List configured networks
     * @returns {Promise<Array>}
     */
    listNetworks: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'listNetworks', []);
        });
    },
    
    /**
     * Scan for networks
     * @returns {Promise<Array>}
     */
    scan: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'scan', []);
        });
    },
    
    /**
     * Start WiFi scan
     * @returns {Promise<void>}
     */
    startScan: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'startScan', []);
        });
    },
    
    /**
     * Get scan results
     * @param {Object} options
     * @returns {Promise<Array>}
     */
    getScanResults: function(options) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getScanResults', [options || {}]);
        });
    },
    
    /**
     * Add WiFi network
     * @param {string} ssid
     * @param {string} authType
     * @param {string} password
     * @param {boolean} isHiddenSSID
     * @returns {Promise<number>}
     */
    add: function(ssid, authType, password, isHiddenSSID) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'add', [
                ssid, authType, password, isHiddenSSID || false
            ]);
        });
    },
    
    /**
     * Remove WiFi network
     * @param {string} ssid
     * @returns {Promise<string>}
     */
    remove: function(ssid) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'remove', [ssid]);
        });
    },
    
    /**
     * Enable network
     * @param {string} ssid
     * @param {boolean} bindAll
     * @param {boolean} waitForConnection
     * @returns {Promise<string>}
     */
    enable: function(ssid, bindAll, waitForConnection) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'enable', [
                ssid, 
                bindAll ? "true" : "false",
                waitForConnection ? "true" : "false"
            ]);
        });
    },
    
    /**
     * Disable network
     * @param {string} ssid
     * @returns {Promise<string>}
     */
    disable: function(ssid) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'disable', [ssid]);
        });
    },
    
    /**
     * Get network ID from SSID
     * @param {string} ssid
     * @returns {Promise<number>}
     */
    getSSIDNetworkID: function(ssid) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getSSIDNetworkID', [ssid]);
        });
    },
    
    /**
     * Reconnect to current network
     * @returns {Promise<string>}
     */
    reconnect: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'reconnect', []);
        });
    },
    
    /**
     * Reassociate with current network
     * @returns {Promise<string>}
     */
    reassociate: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'reassociate', []);
        });
    },
    
    /**
     * Get WiFi IP address
     * @returns {Promise<string>}
     */
    getWifiIP: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getWifiIP', []);
        });
    },
    
    /**
     * Get WiFi IP info (IP and subnet)
     * @returns {Promise<Object>}
     */
    getWifiIPInfo: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getWifiIPInfo', []);
        });
    },
    
    /**
     * Get WiFi router IP
     * @returns {Promise<string>}
     */
    getWifiRouterIP: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getWifiRouterIP', []);
        });
    },
    
    /**
     * Ping WiFi router
     * @returns {Promise<boolean>}
     */
    canPingWifiRouter: function() {
        return new Promise(function(resolve, reject) {
            exec(function(result) {
                resolve(result === "1" || result === true);
            }, reject, 'WiFiBillingAgent', 'canPingWifiRouter', []);
        });
    },
    
    /**
     * Check HTTP connection to router
     * @returns {Promise<boolean>}
     */
    canConnectToRouter: function() {
        return new Promise(function(resolve, reject) {
            exec(function(result) {
                resolve(result === "1" || result === true);
            }, reject, 'WiFiBillingAgent', 'canConnectToRouter', []);
        });
    },
    
    /**
     * Check internet connectivity
     * @returns {Promise<boolean>}
     */
    canConnectToInternet: function() {
        return new Promise(function(resolve, reject) {
            exec(function(result) {
                resolve(result === "1" || result === true);
            }, reject, 'WiFiBillingAgent', 'canConnectToInternet', []);
        });
    },
    
    /**
     * Check if connected to internet
     * @returns {Promise<boolean>}
     */
    isConnectedToInternet: function() {
        return new Promise(function(resolve, reject) {
            exec(function(result) {
                resolve(result === "1" || result === true);
            }, reject, 'WiFiBillingAgent', 'isConnectedToInternet', []);
        });
    },
    
    /**
     * Check if location is enabled
     * @returns {Promise<boolean>}
     */
    isLocationEnabled: function() {
        return new Promise(function(resolve, reject) {
            exec(function(result) {
                resolve(result === "1" || result === true);
            }, reject, 'WiFiBillingAgent', 'isLocationEnabled', []);
        });
    },
    
    /**
     * Request location permission
     * @returns {Promise<string>}
     */
    requestFineLocation: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'requestFineLocation', []);
        });
    },
    
    /**
     * Request location permission (alias for requestFineLocation)
     * Maps the requestPermission name used in index.js to the underlying
     * requestFineLocation action so both call sites resolve correctly.
     * @returns {Promise<string>}
     */
    requestPermission: function() {
        return WifiWizard2.requestFineLocation();
    },

    /**
     * Open location settings
     * @returns {Promise<void>}
     */
    switchToLocationSettings: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'switchToLocationSettings', []);
        });
    },
    
    // ==================== BILLING AGENT EXTENSIONS ====================
    
    /**
     * Check if connected network is a billing network
     * @returns {Promise<boolean>}
     */
    isBillingNetwork: function() {
        return new Promise(function(resolve, reject) {
            exec(function(result) {
                resolve(result && result.isBillingNetwork);
            }, reject, 'WiFiBillingAgent', 'getConnectionInfo', []);
        });
    },
    
    /**
     * Start billing session on current connection
     * @param {Object} options
     * @returns {Promise<Object>}
     */
    startBillingSession: function(options) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'startBillingSession', [options]);
        });
    },
    
    /**
     * Get billing session status
     * @returns {Promise<Object>}
     */
    getBillingSessionStatus: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getSessionStatus', []);
        });
    },
    
    /**
     * Enable bind all (force all traffic through WiFi)
     * @returns {Promise<string>}
     */
    setBindAll: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'setBindAll', []);
        });
    },
    
    /**
     * Reset bind all (allow cellular fallback)
     * @returns {Promise<string>}
     */
    resetBindAll: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'resetBindAll', []);
        });
    }
};

// Legacy callback-style API support (for older code)
WifiWizard2.connectLegacy = function(ssid, bindAll, password, algorithm, isHiddenSSID, successCallback, errorCallback) {
    WifiWizard2.connect(ssid, bindAll, password, algorithm, isHiddenSSID)
        .then(successCallback)
        .catch(errorCallback);
};

// Export for module systems
module.exports = WifiWizard2;

// Also expose on window for legacy compatibility
if (typeof window !== 'undefined') {
    window.WifiWizard2 = WifiWizard2;
}