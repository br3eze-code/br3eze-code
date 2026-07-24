'use strict';
/**
 * The Courier Guy — has no direct public booking/tracking API (their own
 * integration docs are platform plugins for Prestashop/Shopify/WooCommerce,
 * distributed via Dropbox to merchants, not a general REST reference).
 *
 * Real, verified path: AfterShip's unified multi-carrier tracking API
 * (api.aftership.com, header `as-api-key`, POST /tracking/2026-07/trackings
 * with courier slug "thecourierguy") — confirmed against AfterShip's public
 * docs. This gives real TRACKING only; shipment creation/booking must still
 * happen directly with Courier Guy (their portal, plugin, or account team) —
 * createShipment is intentionally not implemented here rather than guessed.
 */
const { jsonRequest } = require('./_http');

class CourierGuyProvider {
    name = 'The Courier Guy (via AfterShip)';
    configHint = 'AFTERSHIP_API_KEY';
    verified = { trackShipment: true, createShipment: false };
    supportsCreate = false;

    constructor(config = {}) {
        this.apiKey = config.aftershipApiKey;
        this.baseUrl = config.aftershipBaseUrl || 'https://api.aftership.com';
    }

    isConfigured() { return !!this.apiKey; }

    _headers() { return { 'as-api-key': this.apiKey }; }

    /** Registers a tracking number with AfterShip so it can be polled/tracked. */
    async registerTracking(trackingId) {
        return jsonRequest(`${this.baseUrl}/tracking/2026-07/trackings`, {
            method: 'POST',
            headers: this._headers(),
            body: { tracking: { tracking_number: trackingId, slug: 'thecourierguy' } },
        });
    }

    async trackShipment(trackingId) {
        const result = await jsonRequest(
            `${this.baseUrl}/tracking/2026-07/trackings/thecourierguy/${encodeURIComponent(trackingId)}`,
            { headers: this._headers() },
        );
        const tracking = result.data?.tracking || result;
        return {
            status: tracking.tag || tracking.subtag_message,
            events: tracking.checkpoints || [],
            raw: tracking,
        };
    }
}

module.exports = CourierGuyProvider;
