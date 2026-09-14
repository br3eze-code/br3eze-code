import { jsonRequest } from './_http.js';

class PargoProvider {
    name = 'Pargo';
    configHint = 'PARGO_API_KEY';
    verified = { trackShipment: false, createShipment: false };
    constructor(config = {}) { this.apiKey = config.pargoApiKey; this.baseUrl = config.pargoBaseUrl || 'https://api.pargo.co.za/v3.1'; }
    isConfigured() { return !!this.apiKey; }
    _headers() { return { Authorization: `Bearer ${this.apiKey}` }; }
    async createShipment(order) {
        const payload = { order_number: order.invoiceNumber || order.orderId, recipient: { name: order.shippingAddress?.name, phone: order.shippingAddress?.phone, email: order.shippingAddress?.email }, delivery_address: order.shippingAddress, parcel: { description: (order.items || []).map((i) => i.name).join(', ').slice(0, 200), value: order.total } };
        const result = await jsonRequest(`${this.baseUrl}/orders`, { method: 'POST', headers: this._headers(), body: payload });
        return { trackingId: result.tracking_code || result.id, raw: result };
    }
    async trackShipment(trackingId) {
        const result = await jsonRequest(`${this.baseUrl}/orders/${encodeURIComponent(trackingId)}/status`, { headers: this._headers() });
        return { status: result.status, events: result.status_history || [], raw: result };
    }
}

export default PargoProvider;
