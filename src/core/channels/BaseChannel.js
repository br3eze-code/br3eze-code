'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');

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
        const allowed = this.config.allowed_ids || [];
        if (allowed.length === 0) return true;

        const idsToCheck = [userId, secondaryId].filter(Boolean).map(id => String(id).toLowerCase());
        
        for (const idStr of idsToCheck) {
            if (allowed.includes(idStr)) return true;

            if (idStr.includes('@')) {
                const number = idStr.split('@')[0];
                if (allowed.some(a => a === number || a === `${number}@s.whatsapp.net` || a === `${number}@lid`)) return true;
            }
        }

        return false;
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

module.exports = { BaseChannel };
