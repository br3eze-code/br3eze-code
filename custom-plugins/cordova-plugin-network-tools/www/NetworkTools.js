/* eslint-env browser */
/* global cordova */
'use strict';

const exec = require('cordova/exec');

const isCordova = () => typeof cordova !== 'undefined' && typeof exec === 'function';

const invoke = (action, payload = {}) => {
  if (!isCordova()) {
    return Promise.resolve({
      supported: false,
      platform: 'web',
      action,
      reason: 'Cordova native bridge is unavailable',
    });
  }

  return new Promise((resolve, reject) => {
    exec(resolve, reject, 'AgentOSNetworkTools', action, [payload]);
  });
};

const NetworkTools = {
  capabilities() {
    return invoke('capabilities');
  },

  connectivity() {
    return invoke('connectivity');
  },

  interfaces() {
    return invoke('interfaces');
  },

  execute(tool, params = {}, context = {}) {
    if (typeof tool !== 'string' || tool.length === 0) {
      throw new TypeError('NetworkTools.execute requires a tool name');
    }

    return invoke('agentRequest', {
      tool,
      params,
      context: {
        ...context,
        source: context.source || 'cordova',
      },
    });
  },

  request(payload = {}) {
    return invoke('agentRequest', payload);
  },
};

if (typeof window !== 'undefined') {
  window.AgentOSNetworkTools = NetworkTools;
}

module.exports = NetworkTools;
