import { EventEmitter } from 'node:events';

const DEFAULT_BASE_URL = 'https://console.ironwifi.com/api';
const ALLOWED_HOSTS = new Set(['ironwifi.com', 'ironwifi.io']);
const READ_ACTIONS = new Set([
  'wifi.users.list',
  'wifi.users.get',
  'wifi.vouchers.list',
  'wifi.networks.list',
  'wifi.networks.get',
  'wifi.captivePortals.list',
  'wifi.captivePortals.get',
  'wifi.reports.get',
]);
const WRITE_ACTIONS = new Set([
  'wifi.users.create',
  'wifi.users.update',
  'wifi.users.delete',
  'wifi.vouchers.create',
]);

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return [...ALLOWED_HOSTS].some((domain) => host === domain || host.endsWith('.' + domain));
}

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('IronWiFi baseUrl must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new TypeError('IronWiFi baseUrl must use HTTPS and contain no credentials, query, or fragment');
  }
  if (!isAllowedHost(url.hostname)) {
    throw new TypeError('IronWiFi baseUrl must use an official ironwifi.com or ironwifi.io host');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function requiredId(value, name = 'id') {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new TypeError(`${name} is required`);
  }
  return encodeURIComponent(String(value));
}

function asObject(value, name = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

/**
 * IronWiFi REST adapter.
 *
 * This adapter only speaks documented IronWiFi REST resources. It does not
 * register itself with AgentRuntime; callers must register it through the
 * existing domain/skill/plugin boundary and enforce user/tenant authorization
 * there. Mutations are additionally disabled unless allowWrites is explicitly
 * enabled in trusted host configuration.
 */
export default class IronWiFiAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.name = 'ironwifi';
    this.type = 'wifi-service';
    this.baseUrl = normalizeBaseUrl(config.baseUrl || process.env.IRONWIFI_BASE_URL || DEFAULT_BASE_URL);
    this.apiToken = config.apiToken || process.env.IRONWIFI_API_TOKEN || '';
    this.companyId = config.companyId || process.env.IRONWIFI_COMPANY_ID || null;
    this.allowWrites = config.allowWrites === true;
    this.timeoutMs = Number.isInteger(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : 10000;
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') throw new TypeError('A Fetch-compatible implementation is required');
    this.connected = false;
  }

  async connect() {
    if (!this.apiToken) throw new Error('IronWiFi API token is not configured');
    this.connected = true;
    this.emit('connected', { provider: this.name, timestamp: new Date().toISOString() });
    return this;
  }

  async disconnect() {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) this.emit('disconnected', { provider: this.name, timestamp: new Date().toISOString() });
  }

  getCapabilities() {
    return {
      name: this.name,
      type: this.type,
      actions: this.listActions(),
      supportsRealtime: false,
      supportsWebhooks: true,
      writesEnabled: this.allowWrites,
    };
  }

  listActions() {
    return [...READ_ACTIONS, ...WRITE_ACTIONS];
  }

  _path(resource, { versionedUsers = false } = {}) {
    const company = this.companyId ? `/${encodeURIComponent(String(this.companyId))}` : '';
    if (versionedUsers) return `${this.baseUrl}/v2${company}/${resource}`;
    return `${this.baseUrl}${company}/${resource}`;
  }

  async _request(path, { method = 'GET', query, body } = {}) {
    if (!this.apiToken) throw new Error('IronWiFi API token is not configured');
    const url = new URL(path);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    let response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      const wrapped = new Error('IronWiFi request failed or timed out');
      wrapped.code = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'IRONWIFI_TIMEOUT' : 'IRONWIFI_TRANSPORT_ERROR';
      throw wrapped;
    }

    if (response.status === 204) return null;
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      if (response.ok) return null;
    }
    if (!response.ok) {
      const error = new Error(`IronWiFi request failed with HTTP ${response.status}`);
      error.code = 'IRONWIFI_HTTP_ERROR';
      error.status = response.status;
      error.providerCode = typeof payload?.code === 'string' ? payload.code : undefined;
      throw error;
    }
    return payload;
  }

  async listUsers(query = {}) { return this._request(this._path('users', { versionedUsers: true }), { query }); }
  async getUser(id) { return this._request(this._path(`users/${requiredId(id, 'userId')}`, { versionedUsers: true })); }
  async createUser(payload) { return this._write('POST', this._path('users', { versionedUsers: true }), asObject(payload)); }
  async updateUser(id, payload) { return this._write('PATCH', this._path(`users/${requiredId(id, 'userId')}`, { versionedUsers: true }), asObject(payload)); }
  async deleteUser(id) { return this._write('DELETE', this._path(`users/${requiredId(id, 'userId')}`, { versionedUsers: true })); }

  async listVouchers(query = {}) { return this._request(this._path('vouchers'), { query }); }
  async createVoucher(payload) { return this._write('POST', this._path('vouchers'), asObject(payload)); }

  async listNetworks(query = {}) { return this._request(this._path('networks'), { query }); }
  async getNetwork(id) { return this._request(this._path(`networks/${requiredId(id, 'networkId')}`)); }
  async listCaptivePortals(query = {}) { return this._request(this._path('captive-portals'), { query }); }
  async getCaptivePortal(id) { return this._request(this._path(`captive-portals/${requiredId(id, 'portalId')}`)); }
  async getReport(id, query = {}) { return this._request(this._path(`reports/${requiredId(id, 'reportId')}`), { query }); }

  async _write(method, path, body) {
    if (!this.allowWrites) {
      const error = new Error('IronWiFi mutations are disabled; enable allowWrites in trusted host configuration after runtime authorization is configured');
      error.code = 'IRONWIFI_WRITES_DISABLED';
      throw error;
    }
    return this._request(path, { method, ...(body === undefined ? {} : { body }) });
  }

  async executeTool(action, params = {}) {
    if (WRITE_ACTIONS.has(action)) {
      if (!this.allowWrites) {
        const error = new Error('IronWiFi mutations are disabled');
        error.code = 'IRONWIFI_WRITES_DISABLED';
        throw error;
      }
    } else if (!READ_ACTIONS.has(action)) {
      const error = new Error(`Unsupported IronWiFi action: ${action}`);
      error.code = 'IRONWIFI_UNSUPPORTED_ACTION';
      throw error;
    }

    switch (action) {
      case 'wifi.users.list': return this.listUsers(params.query || {});
      case 'wifi.users.get': return this.getUser(params.userId);
      case 'wifi.users.create': return this.createUser(params.payload);
      case 'wifi.users.update': return this.updateUser(params.userId, params.payload);
      case 'wifi.users.delete': return this.deleteUser(params.userId);
      case 'wifi.vouchers.list': return this.listVouchers(params.query || {});
      case 'wifi.vouchers.create': return this.createVoucher(params.payload);
      case 'wifi.networks.list': return this.listNetworks(params.query || {});
      case 'wifi.networks.get': return this.getNetwork(params.networkId);
      case 'wifi.captivePortals.list': return this.listCaptivePortals(params.query || {});
      case 'wifi.captivePortals.get': return this.getCaptivePortal(params.portalId);
      case 'wifi.reports.get': return this.getReport(params.reportId, params.query || {});
      default: {
        const error = new Error(`Unsupported IronWiFi action: ${action}`);
        error.code = 'IRONWIFI_UNSUPPORTED_ACTION';
        throw error;
      }
    }
  }

  async destroy() {
    await this.disconnect();
    this.removeAllListeners();
  }
}

export { DEFAULT_BASE_URL, normalizeBaseUrl };
