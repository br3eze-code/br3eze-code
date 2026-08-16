/* eslint-env browser */
/* global cordova */
'use strict';

let exec;

const getExec = () => {
  if (exec) return exec;
  if (typeof cordova === 'undefined') return null;
  try {
    exec = require('cordova/exec');
  } catch (_) {
    exec = null;
  }
  return exec;
};

const isCordova = () => typeof cordova !== 'undefined' && typeof getExec() === 'function';

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
    getExec()(resolve, reject, 'AgentOSNetworkTools', action, [payload]);
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
