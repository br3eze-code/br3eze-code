/* eslint-env browser */
/* global cordova */
'use strict';

const exec = require('cordova/exec');

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
