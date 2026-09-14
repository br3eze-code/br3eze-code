import { jsonRequest } from './_http.js';

class CourierGuyProvider {
    name = 'The Courier Guy (via AfterShip)';
    configHint = 'AFTERSHIP_API_KEY';
    verified = { trackShipment: true, createShipment: false };
    supportsCreate = false;
    constructor(config = {}) { this.apiKey = config.aftershipApiKey; this.baseUrl = config.aftershipBaseUrl || 'https://api.aftership.com'; }
    isConfigured() { return !!this.apiKey; }
    _headers() { return { 'as-api-key': this.apiKey }; }
    async registerTracking(trackingId) {
        return jsonRequest(`${this.baseUrl}/tracking/2026-07/trackings`, { method: 'POST', headers: this._headers(), body: { tracking: { tracking_number: trackingId, slug: 'thecourierguy' } } });
    }
    async trackShipment(trackingId) {
        const result = await jsonRequest(`${this.baseUrl}/tracking/2026-07/trackings/thecourierguy/${encodeURIComponent(trackingId)}`, { headers: this._headers() });
        const tracking = result.data?.tracking || result;
        return { status: tracking.tag || tracking.subtag_message, events: tracking.checkpoints || [], raw: tracking };
    }
}

export default CourierGuyProvider;
