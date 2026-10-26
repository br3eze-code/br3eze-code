import { RouterOSClient } from 'routeros-client';
import EventEmitter from 'node:events';

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
  'nat.list': '/ip/firewall/nat', 'wireless.interfaces': '/interface/wireless'
};

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
  get isConfigured() { return Boolean(this.config.host); }
  getState() { return { ...this.state, host: this.config.host, availableTools: this.getAvailableTools().length }; }
  getAvailableTools() { return [...new Set([...Object.keys(TOOL_PATHS), 'ping', 'user.add', 'user.remove', 'user.kick'])]; }

  async connect() {
    if (!this.config.host) return false;
    if (this.state.isConnected) return true;
    try {
      this.client = new RouterOSClient({ host: this.config.host, user: this.config.user, password: this.config.password, port: this.config.port, timeout: this.config.timeout, tls: this.config.tls });
      let timeoutId;
      try {
        this.conn = await Promise.race([
          this.client.connect(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`Connection timed out after ${this.config.timeout}ms`)), this.config.timeout);
          })
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
      this.state = { isConnected: true, lastError: null, lastConnectedAt: new Date().toISOString() };
      this.emit('connected', { host: this.config.host, timestamp: this.state.lastConnectedAt });
      return true;
    } catch (error) {
      this.state.isConnected = false; this.state.lastError = error;
      throw new ConnectionError(`Failed to connect to ${this.config.host}:${this.config.port}: ${error.message}`, error);
    }
  }

  async disconnect() {
    const wasConnected = this.state.isConnected;
    try { await this.client?.disconnect?.(); } catch { /* adapter shutdown is best effort */ }
    this.state.isConnected = false; this.conn = null;
    if (wasConnected) this.emit('disconnected', { host: this.config.host, timestamp: new Date().toISOString() });
  }
  destroy() { return this.disconnect(); }

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
          return this.addHotspotUser(params.username || params.name, params.password, params.profile || 'default');
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
        case 'nat.list': return this._get('/ip/firewall/nat');
        case 'hotspot.profiles': return this._get('/ip/hotspot/user/profile');
        default: throw new Error(`Unsupported MikroTik tool: ${toolName}`);
      }
    } catch (error) {
      if (error instanceof MikroTikError) throw error;
      throw new ToolExecutionError(toolName, error.message, error);
    }
  }

  getSystemStats() { return this.executeTool('system.stats'); }
  getArpTable() { return this.executeTool('arp.table'); }
  async addHotspotUser(username, password, profile = 'default') {
    if (!username || !password) throw new TypeError('username and password are required');
    await this.connect();
    const profiles = await this._menu('/ip/hotspot/user/profile').get();
    const dnsName = profiles?.[0]?.['dns-name'] || 'localhost';
    const users = await this._menu('/ip/hotspot/user').where('name', username).get();
    const existing = users?.find((user) => user.name === username);
    const definition = { name: username, password, profile, disabled: 'no' };
    if (existing?.['.id']) await this._menu('/ip/hotspot/user').update(existing['.id'], definition);
    else await this._menu('/ip/hotspot/user').add(definition);
    return `http://${dnsName}/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  }
  async getUserStats(username) {
    if (!username) throw new TypeError('username is required');
    await this.connect();
    const users = await this._menu('/ip/hotspot/user').where('name', username).get();
    const user = users?.find((entry) => entry.name === username);
    if (!user) return { success: false, username };
    const activeUsers = await this._menu('/ip/hotspot/active').where('user', username).get();
    const active = activeUsers?.find((entry) => entry.user === username) || null;
    const parseBytes = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const source = String(value || '0').trim();
      const match = source.match(/^(\d+(?:\.\d+)?)\s*([kmgtpe])?i?b?$/i);
      if (!match) {
        const number = Number.parseInt(source, 10);
        return Number.isFinite(number) ? number : 0;
      }
      const powers = { k: 1, m: 2, g: 3, t: 4, p: 5, e: 6 };
      return Number(match[1]) * (match[2] ? 1024 ** powers[match[2].toLowerCase()] : 1);
    };
    const parseDuration = (value) => {
      if (typeof value === 'number') return value;
      const source = String(value || '').trim();
      const clock = source.match(/^(\d+):(\d{2}):(\d{2})$/);
      if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
      const pattern = /(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
      const match = source.match(pattern);
      if (!match || !match[0]) return 0;
      return Number(match[1] || 0) * 604800 + Number(match[2] || 0) * 86400 + Number(match[3] || 0) * 3600 + Number(match[4] || 0) * 60 + Number(match[5] || 0);
    };
    const bytesIn = parseBytes(user['bytes-in']);
    const bytesOut = parseBytes(user['bytes-out']);
    const stats = {
      success: true, username, bytesIn, bytesOut, bytesTotal: bytesIn + bytesOut,
      uptime: parseDuration(user.uptime),
      limitBytesTotal: parseBytes(user['limit-bytes-total']),
      limitUptime: parseDuration(user['limit-uptime']),
      isActive: Boolean(active),
    };
    if (active) stats.session = {
      address: active.address || null,
      uptime: parseDuration(active.uptime),
      bytesIn: parseBytes(active['bytes-in']),
      bytesOut: parseBytes(active['bytes-out']),
      macAddress: active['mac-address'] || null,
    };
    return stats;
  }
  async reboot({ approvalGranted = false } = {}) {
    if (approvalGranted !== true) throw new Error('Router reboot requires explicit approval');
    await this.connect();
    const systemMenu = this._menu('/system');
    if (typeof systemMenu.call !== 'function') throw new Error('RouterOS client does not support the reboot command');
    return systemMenu.call('reboot');
  }
  getActiveUsers() { return this.executeTool('users.active'); }
  addUser(username, password, profile = 'default') { return this.executeTool('user.add', { username, password, profile }); }
  kickUser(username) { return this.executeTool('user.kick', { username }); }
}

let manager;
export function createManager(options = {}) { return new MikroTikManager(options); }
export function getManager(options = {}) { if (!manager) manager = createManager(options); return manager; }
export function resetManager() { manager?.destroy?.(); manager = null; }
export async function getMikroTikClient(options = {}) { const m = getManager(options); await m.connect(); return m; }
export async function testConnection(options = {}) {
  const manager = createManager({ ...options, timeout: options.timeout || 1000 });
  try {
    const success = await manager.connect();
    return { success, message: success ? 'Connected successfully' : 'Connection unavailable' };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    await manager.disconnect();
  }
}
export default MikroTikManager;
