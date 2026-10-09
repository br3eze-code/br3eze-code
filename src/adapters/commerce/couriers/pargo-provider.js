import { jsonRequest } from './_http.js';

class PargoProvider {
    name = 'Pargo';
    configHint = 'PARGO_API_KEY';
    verified = { trackShipment: false, createShipment: false };
    supportsCreate = false;
    constructor(config = {}) { this.apiKey = config.pargoApiKey; this.baseUrl = config.pargoBaseUrl || 'https://api.pargo.co.za/v3.1'; }
    isConfigured() { return !!this.apiKey; }
    _headers() { return { Authorization: `Bearer ${this.apiKey}` }; }
    async trackShipment(trackingId) {
        const result = await jsonRequest(`${this.baseUrl}/orders/${encodeURIComponent(trackingId)}/status`, { headers: this._headers() });
        return { status: result.status, events: result.status_history || [], raw: result };
    }
}

export default PargoProvider;
