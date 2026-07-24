'use strict';
/**
 * DHL Express (MyDHL API).
 *
 * trackShipment: VERIFIED against DHL's public developer.dhl.com docs —
 *   GET {baseUrl}/track/shipments?trackingNumber=X, header `DHL-API-Key`,
 *   response fields shipmentNumber/status/events/estimatedTimeOfDelivery.
 *
 * createShipment: BEST-EFFORT. DHL's real create-shipment schema (multi-piece,
 *   customs docs for international, pickup details) spans a large multi-page
 *   developer guide that wasn't feasible to fully verify here — the payload
 *   below covers only the common fields. Confirm against DHL's full MyDHL API
 *   reference before using this for a real shipment.
 */
const { jsonRequest } = require('./_http');

class DhlProvider {
    name = 'DHL Express';
    configHint = 'DHL_API_KEY';
    verified = { trackShipment: true, createShipment: false };

    constructor(config = {}) {
        this.apiKey = config.dhlApiKey;
        this.baseUrl = config.dhlBaseUrl || 'https://api-eu.dhl.com';
    }

    isConfigured() { return !!this.apiKey; }

    _headers() { return { 'DHL-API-Key': this.apiKey }; }

    async trackShipment(trackingId) {
        const result = await jsonRequest(
            `${this.baseUrl}/track/shipments?trackingNumber=${encodeURIComponent(trackingId)}`,
            { headers: this._headers() },
        );
        const shipment = result.shipments?.[0] || result;
        return {
            status: shipment.status?.description || shipment.status,
            estimatedDelivery: shipment.estimatedTimeOfDelivery || null,
            events: shipment.events || [],
            raw: shipment,
        };
    }

    /** Best-effort — see file header. */
    async createShipment(order) {
        const payload = {
            plannedShippingDateAndTime: new Date().toISOString(),
            productCode: 'P',
            customerDetails: {
                receiverDetails: {
                    postalAddress: order.shippingAddress,
                    contactInformation: {
                        phone: order.shippingAddress?.phone,
                        email: order.shippingAddress?.email,
                        fullName: order.shippingAddress?.name,
                    },
                },
            },
            content: {
                packages: [{ weight: 1, dimensions: { length: 20, width: 20, height: 20 } }],
                description: (order.items || []).map((i) => i.name).join(', ').slice(0, 200),
                declaredValue: order.total,
                declaredValueCurrency: order.currency || 'USD',
            },
        };
        const result = await jsonRequest(`${this.baseUrl}/shipments`, {
            method: 'POST', headers: this._headers(), body: payload,
        });
        return { trackingId: result.shipmentTrackingNumber || result.trackingNumber, raw: result };
    }
}

module.exports = DhlProvider;
