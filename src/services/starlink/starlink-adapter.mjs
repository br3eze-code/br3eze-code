import { EventEmitter } from 'node:events';

const DEFAULT_TIMEOUT_MS = 15_000;

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
}

export class StarlinkAdapter extends EventEmitter {
  constructor({ clientId, clientSecret, baseUrl = process.env.STARLINK_API_BASE_URL, transport = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = baseUrl?.replace(/\/$/, '');
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret && this.baseUrl && this.transport);
  }

  async authenticate() {
    required(this.clientId, 'STARLINK_CLIENT_ID');
    required(this.clientSecret, 'STARLINK_CLIENT_SECRET');
    required(this.baseUrl, 'STARLINK_API_BASE_URL');
    const payload = await this.#request('/oauth/token', {
      method: 'POST',
      body: { grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret },
      authenticated: false,
    });
    this.accessToken = payload.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(30, Number(payload.expires_in || 3600) - 30) * 1000;
    return { expiresAt: new Date(this.tokenExpiresAt).toISOString() };
  }

  async getFleetStats() {
    const data = await this.#api('/fleet/stats');
    return { total: 0, online: 0, degraded: 0, offline: 0, avgLatency: 0, avgSignal: 0, totalDownlink: 0, ...data };
  }

  async getTerminals(options = {}) {
    return this.listTerminals(options);
  }

  async listTerminals({ region, status, limit = 100 } = {}) {
    const data = await this.#api('/terminals', { region, status, limit });
    const terminals = Array.isArray(data) ? data : (data.terminals || data.items || []);
    for (const terminal of terminals) this.emit('terminal:discovered', terminal);
    return terminals;
  }

  async getTerminal(terminalId) {
    required(terminalId, 'terminalId');
    return this.#api(`/terminals/${encodeURIComponent(terminalId)}`);
  }

  async getTerminalHealth(terminalId) {
    required(terminalId, 'terminalId');
    return this.#api(`/terminals/${encodeURIComponent(terminalId)}/health`);
  }

  async getTelemetry(terminalId) {
    required(terminalId, 'terminalId');
    return this.#api(`/terminals/${encodeURIComponent(terminalId)}/telemetry`);
  }

  async rebootTerminal(terminalId) {
    required(terminalId, 'terminalId');
    return this.#api(`/terminals/${encodeURIComponent(terminalId)}/reboot`, {}, { method: 'POST' });
  }

  async stowTerminal(terminalId) {
    required(terminalId, 'terminalId');
    return this.#api(`/terminals/${encodeURIComponent(terminalId)}/stow`, {}, { method: 'POST' });
  }

  async getUsage(terminalId, query = {}) {
    required(terminalId, 'terminalId');
    return this.#api(`/terminals/${encodeURIComponent(terminalId)}/usage`, query);
  }

  async #api(path, query = {}, options = {}) {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) await this.authenticate();
    return this.#request(path, { query, headers: { Authorization: `Bearer ${this.accessToken}` }, ...options });
  }

  async #request(path, { method = 'GET', query = {}, body, headers = {}, authenticated = true } = {}) {
    if (!this.transport) throw new Error('No HTTP transport configured');
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, {
        method,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok) throw new Error(`Starlink API ${response.status}: ${data.error || data.message || text}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}

export default StarlinkAdapter;
