import { getManager } from '../core/mikrotik.js';

/**
 * src/agents/mikrotik.agent.js
 * Thin adapter shim — delegates to src/core/mikrotik via executeTool()
 * so legacy callers (interfaces/api.js, tests, scripts) keep working
 * without needing to know the tool names directly.
 */

function getMikrotik() {
  try { return getManager(); } catch (_) { return null; }
}

const mikrotik = {
  get isConnected() {
    const m = getMikrotik();
    return m ? !!m.isConnected?.() : false;
  },

  async getActiveUsers() {
    const m = getMikrotik();
    if (!m) return [];
    return m.executeTool('users.active', {}, {}).catch(() => []);
  },

  async getAllUsers() {
    const m = getMikrotik();
    if (!m) return [];
    return m.executeTool('mikrotik.hotspot.user.getAll', {}, {}).catch(() => []);
  },

  async addUser(username, password, profile = 'default') {
    const m = getMikrotik();
    if (!m) throw new Error('MikroTik not connected');
    return m.executeTool('mikrotik.hotspot.user.add', { name: username, password, profile }, {});
  },

  async removeUser(username) {
    const m = getMikrotik();
    if (!m) throw new Error('MikroTik not connected');
    return m.executeTool('mikrotik.hotspot.user.remove', { name: username }, {});
  },

  async kickUser(username) {
    const m = getMikrotik();
    if (!m) throw new Error('MikroTik not connected');
    return m.executeTool('user.kick', { target: username }, {});
  },

  async getUserStatus(username) {
    const m = getMikrotik();
    if (!m) return null;
    return m.executeTool('system.stats', { user: username }, {}).catch(() => null);
  },

  async getSystemStats() {
    const m = getMikrotik();
    if (!m) return {};
    return m.executeTool('system.stats', {}, {}).catch(() => ({}));
  },

  async getLogs() {
    const m = getMikrotik();
    if (!m) return [];
    return m.executeTool('system.logs', {}, {}).catch(() => []);
  },
};

export default mikrotik;