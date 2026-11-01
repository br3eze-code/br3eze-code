import { EventEmitter } from 'node:events';
import { RouterOSClient } from 'routeros-client';

export class MikroTikError extends Error {
  constructor(message, code = 'MIKROTIK_ERROR', cause = null) {
    super(message, { cause });
    this.name = 'MikroTikError';
    this.code = code;
  }
}
export class ConnectionError extends MikroTikError { constructor(message, cause) { super(message, 'CONNECTION_ERROR', cause); this.name = 'ConnectionError'; } }
export class ToolExecutionError extends MikroTikError { constructor(toolName, message, cause) { super(`Tool '${toolName}' failed: ${message}`, 'TOOL_ERROR', cause); this.name = 'ToolExecutionError'; this.toolName = toolName; } }

const TOOL_PATHS = {
  'system.resources': '/system/resource', 'system.uptime': '/system/resource', 'system.identity': '/system/identity',
  'system.logs': '/log', 'system.stats': '/system/resource', 'users.active': '/ip/hotspot/active',
  'user.status': '/ip/hotspot/user', 'users.all': '/ip/hotspot/user', 'hotspot.profiles': '/ip/hotspot/user/profile',
  'dhcp.leases': '/ip/dhcp-server/lease', 'interface.list': '/interface', 'arp.table': '/ip/arp',
  'ip.addresses': '/ip/address', 'ip.routes': '/ip/route', 'dns': '/ip/dns', 'firewall.list': '/ip/firewall/filter',
  'nat.list': '/ip/firewall/nat', 'wireless.interfaces': '/interface/wireless',
  'firewall.block': '/ip/firewall/address-list', 'firewall.unblock': '/ip/firewall/address-list'
};

function parseRouterOSDuration(value) {
  if (typeof value !== 'string' || !value) return 0;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(value)) {
    const [hours, minutes, seconds] = value.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }
  const units = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  return [...value.matchAll(/(\d+)(w|d|h|m|s)/g)]
    .reduce((total, match) => total + Number(match[1]) * units[match[2]], 0);
}

function parseRouterOSBytes(value) {
  if (typeof value === 'number') return value;
  const match = String(value ?? '0').trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTP]?)i?B?$/i);
  if (!match) return Number(value) || 0;
  const powers = { '': 0, K: 1, M: 2, G: 3, T: 4, P: 5 };
  return Number(match[1]) * (1024 ** powers[match[2].toUpperCase()]);
}

export class MikroTikManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.config = {
      host: options.host || options.ip || process.env.MIKROTIK_HOST || process.env.MIKROTIK_IP,
      user: options.user || options.username || process.env.MIKROTIK_USER,
      password: options.password || options.pass || process.env.MIKROTIK_PASSWORD || process.env.MIKROTIK_PASS || '',
      port: options.port || 8728,
      timeout: options.timeout || 10000,
      tls: options.tls === true
    };
    this.scope = { tenantId: options.tenantId || null, siteId: options.siteId || null, domain: options.domain || 'network' };
    this.client = null;
    this.conn = null;
    this.state = { isConnected: false, lastError: null, lastConnectedAt: null };
  }

  get isConnected() { return this.state.isConnected; }
  get isConfigured() { return Boolean(this.config.host && this.config.user); }

  getState() {
    return {
      ...this.state,
      host: this.config.host || null,
      isConnected: this.isConnected,
      availableTools: this.getAvailableTools().length
    };
  }

  getAvailableTools() { return Object.keys(TOOL_PATHS).concat(['ping', 'user.add', 'user.remove', 'user.kick']); }

  async connect() {
    if (!this.config.host) return false;
    if (this.state.isConnected) return true;
    try {
      this.client = new RouterOSClient({ host: this.config.host, user: this.config.user, password: this.config.password, port: this.config.port, timeout: this.config.timeout, tls: this.config.tls });
      this.conn = await Promise.race([
        this.client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Connection timed out after ${this.config.timeout}ms`)), this.config.timeout))
      ]);
      this.state = { isConnected: true, lastError: null, lastConnectedAt: new Date().toISOString() };
      this.emit('connected', { host: this.config.host, timestamp: this.state.lastConnectedAt });
      return true;
    } catch (error) {
      this.state.isConnected = false; this.state.lastError = error;
      throw new ConnectionError(`Failed to connect to ${this.config.host}:${this.config.port}: ${error.message}`, error);
    }
  }

  async disconnect() {
    try { await this.client?.disconnect?.(); } catch { /* adapter shutdown is best effort */ }
    const wasConnected = this.state.isConnected;
    this.state.isConnected = false;
    this.conn = null;
    if (wasConnected) this.emit('disconnected', { host: this.config.host, timestamp: new Date().toISOString() });
  }
  destroy() { this.removeAllListeners(); return this.disconnect(); }

  _menu(path) {
    if (!this.conn) throw new ConnectionError('Router is not connected');
    return this.conn.menu(path);
  }
  async _get(path) { await this.connect(); return this._menu(path).get(); }

  async executeTool(toolName, params = {}) {
    try {
      switch (toolName) {
        case 'ping': return this._menu('/').call?.('ping', params) ?? [];
        case 'user.add':
        case 'mikrotik.hotspot.user.add':
          await this.connect(); return this._menu('/ip/hotspot/user').add({ name: params.username || params.name, password: params.password, profile: params.profile || 'default' });
        case 'user.remove':
        case 'mikrotik.hotspot.user.remove': {
          await this.connect(); const users = await this._menu('/ip/hotspot/user').where('name', params.username || params.name).get();
          if (!users[0]?.['.id']) return null; return this._menu('/ip/hotspot/user').remove(users[0]['.id']);
        }
        case 'user.kick': {
          await this.connect(); const active = await this._menu('/ip/hotspot/active').where('user', params.username || params.name || params.target).get();
          if (!active[0]?.['.id']) return null; return this._menu('/ip/hotspot/active').remove(active[0]['.id']);
        }
        case 'users.active': return this._get('/ip/hotspot/active');
        case 'mikrotik.hotspot.user.getAll':
        case 'users.all': return this._get('/ip/hotspot/user');
        case 'system.stats': return this._get('/system/resource');
        case 'system.resources': return this._get('/system/resource');
        case 'system.uptime': { const r = await this._get('/system/resource'); return r[0]?.uptime || null; }
        case 'system.identity': return this._get('/system/identity');
        case 'system.logs': return this._get('/log');
        case 'dhcp.leases': return this._get('/ip/dhcp-server/lease');
        case 'interface.list': return this._get('/interface');
        case 'arp.table': return this._get('/ip/arp');
        case 'ip.addresses': return this._get('/ip/address');
        case 'ip.routes': return this._get('/ip/route');
        case 'dns': return this._get('/ip/dns');
        case 'firewall.list': return this._get('/ip/firewall/filter');
        case 'firewall.block': {
          const address = params.address || params.target || params.ip;
          if (typeof address !== 'string' || !/^(?:\\d{1,3}\\.){3}\\d{1,3}(?:\\/\\d{1,2})?$/.test(address)) {
            throw new TypeError('firewall.block requires a valid IPv4 address or CIDR in params.address');
          }
          const [ip, prefix] = address.split('/');
          if (ip.split('.').some((part) => Number(part) > 255) || (prefix !== undefined && Number(prefix) > 32)) {
            throw new TypeError('firewall.block address is out of range');
          }
          await this.connect();
          // RouterOS address-list entries only enforce blocking when the router
          // has a firewall filter rule matching the "agentos-blocked" list.
          return this._menu('/ip/firewall/address-list').add({ list: 'agentos-blocked', address: ip, comment: 'AgentOS managed block' });
        }
        case 'firewall.unblock': {
          const address = params.address || params.target || params.ip;
          if (typeof address !== 'string' || !/^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(address) || address.split('.').some((part) => Number(part) > 255)) {
            throw new TypeError('firewall.unblock requires a valid IPv4 address in params.address');
          }
          await this.connect();
          const entries = await this._menu('/ip/firewall/address-list').where('list', 'agentos-blocked').where('address', address).get();
          const ids = entries.map((entry) => entry['.id']).filter(Boolean);
          for (const entryId of ids) await this._menu('/ip/firewall/address-list').remove(entryId);
          return { address, removed: ids.length };
        }
        case 'nat.list': return this._get('/ip/firewall/nat');
        case 'hotspot.profiles': return this._get('/ip/hotspot/user/profile');
        case 'system.reboot':
          await this.connect();
          return this._menu('/system').call('reboot', {});
        default: throw new Error(`Unsupported MikroTik tool: ${toolName}`);
      }
    } catch (error) {
      if (error instanceof MikroTikError) throw error;
      throw new ToolExecutionError(toolName, error.message, error);
    }
  }

  getSystemStats() { return this.executeTool('system.stats'); }
  getActiveUsers() { return this.executeTool('users.active'); }
  getArpTable() { return this.executeTool('arp.table'); }
  reboot() { return this.executeTool('system.reboot'); }
  addUser(username, password, profile = 'default') { return this.executeTool('user.add', { username, password, profile }); }
  kickUser(username) { return this.executeTool('user.kick', { username }); }

  async getUserStats(username) {
    if (!username) throw new TypeError('username is required');
    await this.connect();
    const users = await this._menu('/ip/hotspot/user').where('name', username).get();
    const user = users?.[0];
    if (!user) throw new ToolExecutionError('user.stats', `User '${username}' not found`);
    const activeUsers = await this._menu('/ip/hotspot/active').where('user', username).get();
    const session = activeUsers?.[0];
    const bytesIn = parseRouterOSBytes(user['bytes-in']);
    const bytesOut = parseRouterOSBytes(user['bytes-out']);
    return {
      success: true,
      username,
      bytesIn,
      bytesOut,
      bytesTotal: bytesIn + bytesOut,
      uptime: parseRouterOSDuration(user.uptime),
      limitBytesTotal: parseRouterOSBytes(user['limit-bytes-total']),
      limitUptime: parseRouterOSDuration(user['limit-uptime']),
      isActive: Boolean(session),
      ...(session ? { session: {
        address: session.address,
        uptime: parseRouterOSDuration(session.uptime),
        bytesIn: parseRouterOSBytes(session['bytes-in']),
        bytesOut: parseRouterOSBytes(session['bytes-out']),
        macAddress: session['mac-address']
      } } : {})
    };
  }
}

let manager;
export function createManager(options = {}) { return new MikroTikManager(options); }
export function getManager(options = {}) { if (!manager) manager = createManager(options); return manager; }
export function resetManager() { manager?.destroy?.(); manager = null; }
export async function getMikroTikClient(options = {}) { const m = getManager(options); await m.connect(); return m; }
export async function testConnection(options = {}) { try { const m = createManager(options); const ok = await m.connect(); await m.disconnect(); return { success: ok, message: ok ? 'Connected' : 'Missing host configuration' }; } catch (error) { return { success: false, message: error.message }; } }
export default MikroTikManager;
