/* eslint-env browser */
/* global cordova */
'use strict';

let nativeExec;

const unavailable = action => ({
  supported: false,
  nativeReady: false,
  platform: typeof navigator !== 'undefined' && navigator.product === 'ReactNative' ? 'react-native' : 'web',
  action,
  code: 'NATIVE_BRIDGE_UNAVAILABLE',
  reason: 'Cordova native bridge is unavailable',
});

const exec = (success, error, service, action, args) => {
  if (typeof cordova === 'undefined') {
    if (typeof error === 'function') error(unavailable(action));
    return;
  }
  try {
    nativeExec ||= require('cordova/exec');
    return nativeExec(success, error, service, action, args);
  } catch (_) {
    if (typeof error === 'function') error(unavailable(action));
  }
};

const AICore = {
  checkAvailability(success, error) {
    exec(success, error, 'AICorePlugin', 'checkAvailability', []);
  },
  generateText(prompt, success, error) {
    exec(success, error, 'AICorePlugin', 'generateText', [prompt]);
  },
  detectPose(base64Image, success, error) {
    exec(success, error, 'AICorePlugin', 'detectPose', [base64Image]);
  },
};

exports.request = payload =>
  new Promise((resolve, reject) => {
    exec(resolve, reject, 'AICorePlugin', 'request', [payload]);
  });

exports.capabilities = () =>
  new Promise((resolve, reject) => {
    exec(resolve, reject, 'AICorePlugin', 'capabilities', []);
  });

// Polyfill window.ai for Web AI API compatibility
if (typeof window !== 'undefined') {
  window.ai = {
    canCreateTextSession() {
      return new Promise((resolve, reject) => {
        AICore.checkAvailability(
          status => resolve(status), // 'readily' | 'after-download' | 'no'
          err => reject(err)
        );
      });
    },
    createTextSession() {
      return Promise.resolve({
        execute(prompt) {
          return new Promise((resolve, reject) => {
            AICore.generateText(prompt, resolve, reject);
          });
        },
      });
    },
  };
}

export default AICore;
