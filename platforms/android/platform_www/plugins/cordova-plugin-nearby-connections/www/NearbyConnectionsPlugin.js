cordova.define("cordova-plugin-nearby-connections.NearbyConnectionsPlugin", function(require, exports, module) {
var exec = require('cordova/exec');

exports.getPermission = function (arg0, success, error) {
    exec(success, error, 'NearbyConnectionsPlugin', 'getPermission', [arg0]);
};
exports.startAdvertising = function (arg0, success, error) {
    exec(success, error, 'NearbyConnectionsPlugin', 'startAdvertising', [arg0]);
};
exports.connectToEndpoint = function (arg0, success, error) {
    exec(success, error, 'NearbyConnectionsPlugin', 'connectToEndpoint', [arg0]);
};
exports.transferData = function (message, payload, success, error) {
    exec(success, error, 'NearbyConnectionsPlugin', 'transferData', [message, payload]);
};
exports.listenForTransfer = function (arg0, success, error) {
    exec(success, error, 'NearbyConnectionsPlugin', 'listenForTransfer', [arg0]);
};
});
