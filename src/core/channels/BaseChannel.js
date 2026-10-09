import EventEmitter from 'events';
import crypto from 'crypto';



class BaseChannel extends EventEmitter {
    static register(type, cls) {
        this.registry[type.toLowerCase()] = cls;
    }

    constructor(config, agent) {
        super();
        this.config = config;
        this.agent = agent;
        this.id = crypto.randomUUID();
        this.connected = false;
        this.messageCount = 0;
        this.errorCount = 0;
    }

    static getMetadata() {
        return {
            name: 'Base Channel',
            description: 'Abstract base for messaging channels',
            configFields: []
        };
    }

    static getAdapter(type) {
        return this.registry[type.toLowerCase()];
    }

    static getRegisteredTypes() {
        return Object.keys(this.registry);
    }

    static getRegistry() {
        return this.registry;
    }

    async initialize() {
        throw new Error('initialize() not implemented');
    }

    async send(userId, message) {
        throw new Error('send() not implemented');
    }

    async broadcast(message) {
        throw new Error('broadcast() not implemented');
    }

    formatMessage(message) {
        if (typeof message === 'string') {
            return { text: message };
        }
        return message;
    }

    getStatus() {
        return {
            id: this.id,
            connected: this.connected,
            messages: this.messageCount,
            errors: this.errorCount
        };
    }

    isAuthorized(userId, secondaryId = null) {
        if (!userId && !secondaryId) return false;
    const allowed = (this.config.allowed_ids || this.config.allowedIds || []).map((id) => String(id).toLowerCase());
    const idsToCheck = [userId, secondaryId].filter(Boolean).map(id => String(id).trim().toLowerCase());
    const anonymousAllowed = this.config.allowAnonymous === true || this.config.allow_anonymous === true;
    if (idsToCheck.length === 0) return anonymousAllowed;
    if (allowed.length === 0) return anonymousAllowed;

    return idsToCheck.some((idStr) => {
      if (allowed.includes(idStr)) return true;
      const bare = idStr.split('@')[0];
      return allowed.includes(bare) || allowed.includes(`${bare}@s.whatsapp.net`) || allowed.includes(`${bare}@lid`);
    });
    }

    /**
     * Validate the current configuration for this channel.
     * @returns {Promise<{valid: boolean, error: string|null}>}
     */
    async validateConfig() {
        return { valid: true, error: null };
    }

    async destroy() {
        this.removeAllListeners();
    }
}

// Static field assigned after class definition (Babel class-properties plugin not required)
BaseChannel.registry = {};

export { BaseChannel };
