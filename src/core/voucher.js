import eventBus from '../core/eventBus.js';
import { getConfig } from './config.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * VoucherAgent — Voucher generation & event emission
 * @module core/voucher
 * @version 2026.04.23
 */


class VoucherAgent {
    constructor() {
        // We load config on demand to ensure we have the latest environment overrides
    }

    get _config() {
        const config = getConfig();
        return config.vouchers || config.tools?.voucher || {
            prefix: 'STAR',
            format: 'XXXX-XXXX',
            alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        };
    }

    get _validPlans() {
        const config = getConfig();
        // Canonical hardcoded aliases — both display name style AND mikrotikProfile style
        const plans = new Set(['default', '1hour', '1day', '1week', '30day', '7day', '1month']);
        
        // Dynamically add plans from MikroTik profiles
        const profiles = config.tools?.mikrotik?.profiles;
        if (Array.isArray(profiles)) {
            profiles.forEach(p => {
                if (p.name) plans.add(p.name);
                if (p.mikrotikProfile) plans.add(p.mikrotikProfile);
            });
        }
        
        // Also add plans from top-level config (used by onboard wizard)
        // Add BOTH the display name and the mikrotikProfile identifier
        if (Array.isArray(config.plans)) {
            config.plans.forEach(p => {
                if (p.name) plans.add(p.name);
                if (p.mikrotikProfile) plans.add(p.mikrotikProfile);
            });
        }
        
        return plans;
    }
    
    async generate(plan = 'default') {
        const validPlans = this._validPlans;
        let matchedPlan = plan;
        if (!validPlans.has(plan)) {
            const lowerPlan = plan.toLowerCase();
            let found = false;
            for (const valid of validPlans) {
                if (valid.toLowerCase() === lowerPlan) {
                    matchedPlan = valid;
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw new Error(`Invalid plan '${plan}'. Available: ${[...validPlans].join(', ')}`);
            }
        }
        plan = matchedPlan;

        const config = this._config;
        const chars = config.alphabet || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const crypto = require('crypto');
        
        const genPart = (len = 4) => {
            let s = '';
            for (let i = 0; i < len; i++) {
                const idx = crypto.randomInt(0, chars.length);
                s += chars.charAt(idx);
            }
            return s;
        };

        const format = config.format || 'XXXX-XXXX';
        const prefix = config.prefix || 'STAR';
        
        let code;
        let attempts = 0;
        const { getDatabase } = require('./database');
        const db = await getDatabase();

        // Ensure uniqueness
        while (attempts < 10) {
            let codePart = format.replace(/X+/g, (m) => genPart(m.length));
            code = prefix ? `${prefix}-${codePart}` : codePart;
            
            const existing = await db.getVoucher(code);
            if (!existing) break;
            attempts++;
        }

        eventBus.emit('voucher.created', { code, plan, createdAt: new Date().toISOString() });
        return code;
    }
    
    async createVoucher(plan = 'default') {
        const code = await this.generate(plan);
        const password = code; // Using code as password for simplicity in hotspots
        
        // Provision to MikroTik if available
        let loginUrl = '';
        if (global.mikrotik && global.mikrotik.isConnected) {
            try {
                loginUrl = await global.mikrotik.executeTool('user.add', {
                    username: code,
                    password: password,
                    profile: plan
                });
            } catch (err) {
                console.error(`[Voucher] MikroTik provisioning failed for ${code}: ${err.message}`);
            }
        } else {
            console.warn('[Voucher] MikroTik not connected — voucher generated but not provisioned to router.');
        }
        
        // Return structured voucher data for printing/response
        return {
            username: code,
            password: password,
            profile: plan,
            loginUrl: loginUrl || `http://hotspot.local/login?username=${code}&password=${password}`,
            createdAt: new Date().toISOString()
        };
    }

    async updateVoucher(code, plan = 'default') {
        const { getDatabase } = require('./database');
        const db = await getDatabase();
        const existing = await db.getVoucher(code);
        
        if (!existing) {
            throw new Error(`Voucher '${code}' not found in database.`);
        }

        // 1. Update on MikroTik if available
        let loginUrl = existing.loginUrl || '';
        if (global.mikrotik && global.mikrotik.isConnected) {
            try {
                const result = await global.mikrotik.executeTool('user.edit', {
                    username: code,
                    profile: plan
                });
                if (result.updated) {
                    // Re-fetch status to get updated login URL if needed (though usually same)
                    const status = await global.mikrotik.getUserStatus(code);
                    if (status.session) {
                        // If active, maybe we need to kick them to apply new profile? 
                        // But user.edit usually applies to new sessions.
                    }
                }
            } catch (err) {
                console.error(`[Voucher] MikroTik update failed for ${code}: ${err.message}`);
            }
        }

        // 2. Update in Database
        await db.updateVoucher(code, {
            plan: plan,
            status: 'active',
            updatedAt: new Date().toISOString()
        });

        const updated = await db.getVoucher(code);
        return updated;
    }

    redeem(code, user) {
        if (!code || !user) throw new Error('code and user are required');
        eventBus.emit('voucher.redeemed', { code, user, redeemedAt: new Date().toISOString() });
    }
}

export default new VoucherAgent();
