'use strict';
/**
 * VoucherAgent — Voucher generation & event emission
 * @module core/voucher
 * @version 2026.04.18

 */

'use strict';

const crypto = require('crypto');
const eventBus = require('../core/eventBus');

const VALID_PLANS = new Set(['1hour', '1day', '1week', '1month', 'default']);

class VoucherAgent {
    constructor() {
        this.issued = new Set();
    }

    generate(plan = 'default') {
        if (!VALID_PLANS.has(plan)) {
            throw new Error(`Invalid plan '${plan}'. Valid: ${[...VALID_PLANS].join(', ')}`);
        }

        const token = crypto.randomBytes(4).toString('hex').toUpperCase();
        const code = `V-${plan.toUpperCase()}-${token}`;

        this.issued.add(code);

        if (eventBus.listenerCount('voucher.created') > 0) {
            eventBus.emit('voucher.created', { 
                code, 
                plan, 
                createdAt: new Date().toISOString() 
            });
        }

        return code;
    }
    
    redeem(code, user) {
        if (!code || typeof code !== 'string') {
            throw new Error('Voucher code is required');
        }
        if (!user || typeof user !== 'string') {
            throw new Error('Username is required');
        }
        if (!this.issued.has(code)) {
            throw new Error('Invalid or unknown voucher code');
        }

        eventBus.emit('voucher.redeemed', { 
            code, 
            user, 
            redeemedAt: new Date().toISOString() 
        });
        
        return { code, user, status: 'redeemed' };
    }

    validate(code) {
        return this.issued.has(code);
    }
}

module.exports = new VoucherAgent();
