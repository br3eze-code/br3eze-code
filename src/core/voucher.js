'use strict';
/**
 * VoucherAgent — Voucher generation & event emission
 * @module core/voucher
 * @version 2026.03.27

 */

const crypto    = require('crypto');
const eventBus  = require('../core/eventBus');

const VALID_PLANS = new Set(['1hour', '1day', '1week', '1month', 'default']);

class VoucherAgent {
    
    generate(plan = 'default') {
        if (!VALID_PLANS.has(plan)) {
            throw new Error(`Invalid plan '${plan}'. Valid: ${[...VALID_PLANS].join(', ')}`);
        }

        const token = crypto.randomBytes(4).toString('hex').toUpperCase();
        const code  = `V-${plan.toUpperCase()}-${token}`;

        eventBus.emit('voucher.created', { code, plan, createdAt: new Date().toISOString() });
        return code;
    }
    
    redeem(code, user) {
        if (!code || !user) throw new Error('code and user are required');
        eventBus.emit('voucher.redeemed', { code, user, redeemedAt: new Date().toISOString() });
    }
}

module.exports = new VoucherAgent();
