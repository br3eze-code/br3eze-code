import { jsonRequest } from './_http.js';

class DhlProvider {
    name = 'DHL Express';
    configHint = 'DHL_API_KEY';
    verified = { trackShipment: true, createShipment: false };
    supportsCreate = false;

    constructor(config = {}) { this.apiKey = config.dhlApiKey; this.baseUrl = config.dhlBaseUrl || 'https://api-eu.dhl.com'; }
    isConfigured() { return !!this.apiKey; }
    _headers() { return { 'DHL-API-Key': this.apiKey }; }

    async trackShipment(trackingId) {
        const result = await jsonRequest(`${this.baseUrl}/track/shipments?trackingNumber=${encodeURIComponent(trackingId)}`, { headers: this._headers() });
        const shipment = result.shipments?.[0] || result;
        return { status: shipment.status?.description || shipment.status, estimatedDelivery: shipment.estimatedTimeOfDelivery || null, events: shipment.events || [], raw: shipment };
    }
}

export default DhlProvider;
