var exec = require('cordova/exec');

var AICore = {
    checkAvailability: function (success, error) {
        exec(success, error, 'AICorePlugin', 'checkAvailability', []);
    },
    generateText: function (prompt, success, error) {
        exec(success, error, 'AICorePlugin', 'generateText', [prompt]);
    },
    detectPose: function (base64Image, success, error) {
        exec(success, error, 'AICorePlugin', 'detectPose', [base64Image]);
    }
};

exports.request = function (payload) {
    return new Promise((resolve, reject) => {
        exec(resolve, reject, "AiCorePlugin", "request", [payload]);
    });
};

exports.capabilities = function () {
    return new Promise((resolve, reject) => {
        exec(resolve, reject, "AiCorePlugin", "capabilities", []);
    });
};

// Polyfill window.ai for future-proofing and standardizing
if (typeof window !== 'undefined') {
    window.ai = {
        canCreateTextSession: function () {
            return new Promise(function (resolve, reject) {
                AICore.checkAvailability(function (status) {
                    resolve(status); // "readily", "after-download", or "no"
                }, function (err) {
                    reject(err);
                });
            });
        },
        createTextSession: function () {
            return Promise.resolve({
                execute: function (prompt) {
                    return new Promise(function (resolve, reject) {
                        AICore.generateText(prompt, function (result) {
                            resolve(result);
                        }, function (err) {
                            reject(err);
                        });
                    });
                }
            });
        }
    };
}

module.exports = AICore;
