var exec = require('cordova/exec');

var BackgroundModern = {
    start: function (success, error) {
        exec(success || function () {}, error || function () {}, 'BackgroundPlugin', 'start', []);
    },

    stop: function (success, error) {
        exec(success || function () {}, error || function () {}, 'BackgroundPlugin', 'stop', []);
    },

    status: function (success, error) {
        exec(success || function () {}, error || function () {}, 'BackgroundPlugin', 'status', []);
    }
};

module.exports = BackgroundModern;
