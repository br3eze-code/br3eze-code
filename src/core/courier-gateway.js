'use strict';
/**
 * Pluggable courier/delivery gateway — mirrors src/payments/payment-gateway.js's
 * multi-provider pattern (Map of provider id -> instance, config-driven activation).
 *
 * Every provider is REGISTERED regardless of whether it has real credentials
 * (mirrors config.payments = {provider:'none', configured:false}) so callers can
 * see it listed as "not configured" rather than the provider silently not existing.
 *
 * Confidence per provider (see each file's header comment for details):
 *  - dhl:         tracking verified against DHL's public MyDHL API docs;
 *                 shipment creation is best-effort (DHL's create-shipment schema
 *                 is large/multi-page — verify against the full developer guide
 *                 before relying on it for a real shipment).
 *  - pargo:       best-effort scaffold — Pargo's API requires a merchant
 *                 relationship and an emailed auth token; no public endpoint
 *                 docs were accessible, so exact paths/fields are UNVERIFIED.
 *  - courier_guy: real, verified tracking via AfterShip's unified tracking API
 *                 (The Courier Guy has no direct public booking/creation API).
 *                 createShipment is NOT supported through this path.
 */
const { logger } = require('./logger');

class CourierGateway {
    constructor(config = {}) {
        this.config = {
            dhlApiKey: config.dhlApiKey || process.env.DHL_API_KEY,
            dhlBaseUrl: config.dhlBaseUrl || process.env.DHL_BASE_URL || 'https://api-eu.dhl.com',
            pargoApiKey: config.pargoApiKey || process.env.PARGO_API_KEY,
            pargoBaseUrl: config.pargoBaseUrl || process.env.PARGO_BASE_URL || 'https://api.pargo.co.za/v3.1',
            aftershipApiKey: config.aftershipApiKey || process.env.AFTERSHIP_API_KEY,
            aftershipBaseUrl: config.aftershipBaseUrl || process.env.AFTERSHIP_BASE_URL || 'https://api.aftership.com',
            ...config,
        };
        this.providers = new Map();
        this._initProviders();
    }

    _initProviders() {
        const DhlProvider = require('./couriers/dhl-provider');
        const PargoProvider = require('./couriers/pargo-provider');
        const CourierGuyProvider = require('./couriers/courier-guy-provider');
        this.providers.set('dhl', new DhlProvider(this.config));
        this.providers.set('pargo', new PargoProvider(this.config));
        this.providers.set('courier_guy', new CourierGuyProvider(this.config));
    }

    getAvailableProviders() {
        return [...this.providers.entries()].map(([id, p]) => ({
            id, name: p.name, configured: p.isConfigured(), verified: p.verified,
            supportsCreate: typeof p.createShipment === 'function' && p.supportsCreate !== false,
        }));
    }

    _get(providerId) {
        const p = this.providers.get(providerId);
        if (!p) throw new Error(`Unknown courier provider: ${providerId}. Available: ${[...this.providers.keys()].join(', ')}`);
        if (!p.isConfigured()) throw new Error(`${p.name} is not configured — set ${p.configHint} first.`);
        return p;
    }

    async createShipment(providerId, order) {
        const p = this._get(providerId);
        if (p.supportsCreate === false) throw new Error(`${p.name} does not support creating shipments via this integration — book directly with the provider.`);
        logger.info(`[CourierGateway] createShipment via ${p.name} for order ${order.orderId || order.id}`);
        return p.createShipment(order);
    }

    async trackShipment(providerId, trackingId) {
        const p = this._get(providerId);
        return p.trackShipment(trackingId);
    }
}

let instance = null;
function getCourierGateway(config) {
    if (!instance) instance = new CourierGateway(config);
    return instance;
}

module.exports = { CourierGateway, getCourierGateway };
