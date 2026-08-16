import { logger } from './logger.js';
import DhlProvider from './couriers/dhl-provider.js';
import PargoProvider from './couriers/pargo-provider.js';
import CourierGuyProvider from './couriers/courier-guy-provider.js';

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

function sanitizeLocationContext(context = {}) {
    const permissionGranted = context.locationPermission === true
      || ['true', 'granted', 'allowed', 'precise', 'approximate'].includes(String(context.locationPermission || '').toLowerCase());
    if (!permissionGranted) return { permissionGranted: false };
    const source = context.locationContext || context.location || {};
    return {
        permissionGranted: true,
        countryCode: source.countryCode || source.country || context.country || null,
        region: source.region || source.state || null,
        siteId: context.siteId || context.scope?.siteId || null,
    };
}

function auditContext(context = {}) {
    const scope = context.scope || {};
    return {
        userId: context.userId || null,
        tenantId: context.tenantId || scope.tenantId || null,
        domain: context.domain || scope.domain || null,
        siteId: context.siteId || scope.siteId || null,
        role: context.role || (Array.isArray(context.roles) ? context.roles[0] : null),
        location: sanitizeLocationContext(context),
    };
}

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
        this.auditSink = typeof config.auditSink === 'function' ? config.auditSink : null;
        this.providers = new Map();
        this._initProviders();
    }

    _initProviders() {
        this.providers.set('dhl', new DhlProvider(this.config));
        this.providers.set('pargo', new PargoProvider(this.config));
        this.providers.set('courier_guy', new CourierGuyProvider(this.config));
    }

    _audit(action, details, context = {}) {
        const event = { action, ...auditContext(context), ...details, at: new Date().toISOString() };
        if (this.auditSink) this.auditSink(event);
        if (typeof logger.audit === 'function') logger.audit(action, event);
        else logger.debug(`[CourierGateway] ${action} tenant=${event.tenantId || 'unscoped'} user=${event.userId || 'anonymous'} provider=${event.provider || 'none'}`);
        return event;
    }

    getAvailableProviders(context = {}) {
        this._audit('courier.providers.list', { provider: null }, context);
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

    async createShipment(providerId, order, context = {}) {
        const p = this._get(providerId);
        const locationContext = sanitizeLocationContext(context);
        if (p.supportsCreate === false) throw new Error(`${p.name} does not support creating shipments via this integration — book directly with the provider.`);
        this._audit('courier.shipment.create', { provider: providerId, orderId: order.orderId || order.id, locationContext }, context);
        return p.createShipment({ ...order, agentContext: { location: locationContext } });
    }

    async trackShipment(providerId, trackingId, context = {}) {
        const p = this._get(providerId);
        this._audit('courier.shipment.track', { provider: providerId, trackingId }, context);
        return p.trackShipment(trackingId);
    }
}

let instance = null;
function getCourierGateway(config) {
    if (!instance) instance = new CourierGateway(config);
    return instance;
}

export { CourierGateway, getCourierGateway };
