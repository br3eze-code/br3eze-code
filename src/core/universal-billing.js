import crypto from 'crypto';
import { EventEmitter } from 'events';
import { logger } from './logger.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * UniversalBilling — Voucher & Payment System
 * Supports: PesaPay, Stripe, M-Pesa (Daraja), Mastercard/Peach, Webhook, None
 */


class UniversalBilling extends EventEmitter {
    constructor(config = {}) {
        super();
        this.db = config.database || null;
        this.mikrotik = config.mikrotik || null;
        this.resourceType = config.resourceType || 'network';
        this.config = config;

        // Payment provider from config or env
        const provider = config.paymentProvider
            || process.env.PAYMENT_PROVIDER
            || 'none';

        this.provider = provider.toLowerCase();
        this._client = null; // lazy-initialised SDK client
    }

    // ── Payment provider wiring ──────────────────────────────────────────────

    /**
     * Returns a payment link (URL string) for the given plan.
     * Caller shows this URL to the end-user (Telegram, web, SMS).
     */
    async createPaymentLink({ plan, label, amount, currency }) {
        const cfg = this.config.payments || this._readConfigFile();
        const amt = amount || this._getPlanAmount(plan, cfg);
        const cur = (currency || cfg?.currency || process.env.PAYMENT_CURRENCY || 'USD').toUpperCase();
        const lbl = label || plan || 'AgentOS Access';

        switch (this.provider) {
            case 'stripe': return this._stripeLink(plan, amt, cur, lbl, cfg);
            case 'pesapay': return this._pesapayLink(plan, amt, cur, lbl, cfg);
            case 'mpesa': return this._mpesaLink(plan, amt, cur, lbl, cfg);
            case 'mastercard':
            case 'peach': return this._peachLink(plan, amt, cur, lbl, cfg);
            case 'mastercard-a2a': return this._mastercardA2ALink(plan, amt, cur, lbl, cfg);
            case 'a2a': return this._mastercardA2ALink(plan, amt, cur, lbl, cfg);
            case 'webhook': return this._webhookLink(plan, amt, cur, lbl, cfg);
            default:
                throw new Error(
                    `No payment provider configured (provider="${this.provider}"). ` +
                    `Set PAYMENT_PROVIDER env var or run: agentos onboard`
                );
        }
    }

    /**
     * Verify a payment reference — returns { paid: boolean, reference, plan }
     */
    async verifyPayment(reference) {
        const cfg = this.config.payments || this._readConfigFile();
        switch (this.provider) {
            case 'stripe': return this._stripeVerify(reference, cfg);
            case 'pesapay': return this._pesapayVerify(reference, cfg);
            case 'mpesa': return this._mpesaVerify(reference, cfg);
            case 'mastercard':
            case 'peach': return this._peachVerify(reference, cfg);
            case 'mastercard-a2a':
            case 'a2a': return this._mastercardA2AVerify(reference, cfg);
            case 'webhook': return { paid: true, reference }; // trust webhook IPN
            default: return { paid: false, reason: 'no_provider' };
        }
    }

    // ── Stripe ───────────────────────────────────────────────────────────────

    async _stripeLink(plan, amount, currency, label, cfg) {
        const secretKey = cfg?.credentials?.secretKey || process.env.STRIPE_SECRET_KEY;
        if (!secretKey) throw new Error('Stripe secret key not configured');

        const stripe = require('stripe')(secretKey);
        const reference = `agentos-${plan}-${Date.now()}`;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: currency.toLowerCase(),
                    product_data: { name: `AgentOS — ${label}` },
                    unit_amount: Math.round(amount * 100)   // Stripe uses cents
                },
                quantity: 1
            }],
            mode: 'payment',
            success_url: cfg?.credentials?.successUrl || process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/success?session={CHECKOUT_SESSION_ID}',
            cancel_url: cfg?.credentials?.cancelUrl || process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/cancel',
            client_reference_id: reference,
            metadata: { plan, reference }
        });

        return session.url;
    }

    async _stripeVerify(sessionId, cfg) {
        const secretKey = cfg?.credentials?.secretKey || process.env.STRIPE_SECRET_KEY;
        if (!secretKey) return { paid: false, reason: 'no_key' };
        const stripe = require('stripe')(secretKey);
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        return {
            paid: session.payment_status === 'paid',
            reference: sessionId,
            plan: session.metadata?.plan
        };
    }

    // ── PesaPay ───────────────────────────────────────────────────────────────

    async _pesapayLink(plan, amount, currency, label, cfg) {
        const axios = require('axios');
        const apiKey = cfg?.credentials?.apiKey || process.env.PESAPAY_API_KEY;
        const merchantId = cfg?.credentials?.merchantId || process.env.PESAPAY_MERCHANT_ID;
        const baseUrl = cfg?.credentials?.baseUrl || process.env.PESAPAY_BASE_URL || 'https://www.pesapay.co.za';

        if (!apiKey || !merchantId) throw new Error('PesaPay API key / merchant ID not configured');

        const reference = `AGT-${plan}-${Date.now()}`;
        const payload = {
            merchantId,
            merchantReference: reference,
            amount: amount.toFixed(2),
            currency,
            description: `AgentOS — ${label}`,
            redirectUrl: process.env.PESAPAY_REDIRECT_URL || `${baseUrl}/return`
        };

        const response = await axios.post(
            `${baseUrl}/api/paynow/v2/payment/initiate`,
            payload,
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );

        if (!response.data?.redirectUrl) {
            throw new Error(`PesaPay did not return a redirect URL: ${JSON.stringify(response.data)}`);
        }
        return response.data.redirectUrl;
    }

    async _pesapayVerify(reference, cfg) {
        const axios = require('axios');
        const apiKey = cfg?.credentials?.apiKey || process.env.PESAPAY_API_KEY;
        const merchantId = cfg?.credentials?.merchantId || process.env.PESAPAY_MERCHANT_ID;
        const baseUrl = cfg?.credentials?.baseUrl || process.env.PESAPAY_BASE_URL || 'https://www.pesapay.co.za';

        const resp = await axios.get(
            `${baseUrl}/api/paynow/v2/payment/query/${reference}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        return {
            paid: resp.data?.status?.toLowerCase() === 'paid',
            reference,
            plan: resp.data?.description
        };
    }


    // ── M-Pesa / Mobile Money ─────────────────────────────────────────────────

    async _mpesaLink(plan, amount, currency, label, cfg) {
        // Route to the correct mobile money provider
        const mpesaProvider = process.env.MPESA_PROVIDER || 'safaricom';
        return this._mpesaInitiateSTK(null, amount, plan, cfg, mpesaProvider);
    }

    /**
     * Initiate an STK Push / mobile money request.
     * @param {string|null} phone  — null means no phone provided yet (returns instructions)
     * @param {number} amount
     * @param {string} plan
     * @param {object} cfg
     * @param {string} [providerOverride]  'safaricom' | 'vodacom' | 'mtn' | 'airtel'
     */
    async _mpesaInitiateSTK(phone, amount, plan, cfg, providerOverride) {
        const { MobileMoney } = require('../services/mobile-money');
        const mm = new MobileMoney();
        const provider = providerOverride
            || cfg?.credentials?.provider
            || process.env.MPESA_PROVIDER
            || 'safaricom';

        if (!phone) {
            // No phone supplied — return instructions text (Telegram will ask user for phone)
            const shortcode = process.env.MPESA_SHORTCODE || cfg?.credentials?.shortcode || '174379';
            return (
                `📲 *Mobile Money Payment*\n\n` +
                `Amount: *${amount}* (Plan: ${plan})\n` +
                `Provider: *${provider}*\n\n` +
                `Use /pay ${plan} <phone> to receive an STK push to your phone.\n` +
                `Example: /pay 1Day +254712345678`
            );
        }

        try {
            const result = await mm.initiate(provider, phone, amount, `AGT-${plan}`);
            logger.info(`[Billing] STK Push sent via ${provider} to ${phone} (${plan})`);
            return result;
        } catch (err) {
            logger.error(`[Billing] STK Push failed (${provider}):`, err.message);
            throw err;
        }
    }

    /**
     * Verify a mobile money payment by checkout ID.
     */
    async _mpesaVerify(checkoutRequestId, cfg) {
        const { MobileMoney } = require('../services/mobile-money');
        const mm = new MobileMoney();
        const provider = cfg?.credentials?.provider || process.env.MPESA_PROVIDER || 'safaricom';

        try {
            const result = await mm.verify(provider, checkoutRequestId);
            return {
                paid:      result.paid,
                reference: checkoutRequestId,
                ...result
            };
        } catch (error) {
            logger.error('[Billing] M-Pesa verification failed:', error.message);
            return { paid: false, reason: 'api_error', error: error.message };
        }
    }



    // ── Mastercard / Peach Payments ───────────────────────────────────────────

    async _peachLink(plan, amount, currency, label, cfg) {
        const axios = require('axios');
        const apiKey = cfg?.credentials?.apiKey || process.env.PEACH_API_KEY;
        const entityId = cfg?.credentials?.entityId || process.env.PEACH_ENTITY_ID;
        const baseUrl = cfg?.credentials?.baseUrl || process.env.PEACH_BASE_URL || 'https://testsecure.peachpayments.com';

        if (!apiKey || !entityId) throw new Error('Peach Payments credentials not configured');

        const reference = `AGT-${plan}-${Date.now()}`;
        const params = new URLSearchParams({
            'authentication.userId': entityId,
            'authentication.password': apiKey,
            'authentication.entityId': entityId,
            'amount': amount.toFixed(2),
            'currency': currency,
            'paymentType': 'DB',
            'merchantTransactionId': reference,
            'descriptor': `AgentOS ${label}`
        });

        const resp = await axios.post(
            `${baseUrl}/v1/checkouts`,
            params.toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        return `${baseUrl}/v1/paymentWidgets.js?checkoutId=${resp.data?.id}`;
    }

    async _peachVerify(checkoutId, cfg) {
        const axios = require('axios');
        const apiKey = cfg?.credentials?.apiKey || process.env.PEACH_API_KEY;
        const entityId = cfg?.credentials?.entityId || process.env.PEACH_ENTITY_ID;
        const baseUrl = cfg?.credentials?.baseUrl || process.env.PEACH_BASE_URL || 'https://testsecure.peachpayments.com';

        if (!apiKey || !checkoutId) return { paid: false, reason: 'missing_id' };

        try {
            const resp = await axios.get(
                `${baseUrl}/v1/checkouts/${checkoutId}/payment`,
                { params: { entityId }, headers: { 'Authorization': `Bearer ${apiKey}` } }
            );

            // result.code patterns like '000.000.000' or '000.100.110' are successful
            const code = resp.data?.result?.code;
            const paid = /^(000\.000\.|000\.100\.|000\.400\.)/.test(code);

            return {
                paid,
                reference: checkoutId,
                status: resp.data?.result?.description,
                code
            };
        } catch (error) {
            console.error('[Peach] Verification failed:', error.response?.data || error.message);
            return { paid: false, reason: 'api_error' };
        }
    }

    // ── Mastercard A2A ───────────────────────────────────────────────────────

    async _mastercardA2ALink(plan, amount, currency, label, cfg) {
        const MastercardA2A = require('../../services/mastercardA2A');
        const service = new MastercardA2A();
        const code = this.generateSecureCode();
        
        // Use a default business account if not in config
        const recipientAccount = cfg?.credentials?.recipientAccount || process.env.MASTERCARD_RECIPIENT_ACCOUNT || 'ZW1234567890';
        const recipientBankCode = cfg?.credentials?.recipientBankCode || process.env.MASTERCARD_RECIPIENT_BANK || 'BR3EZE';

        const result = await service.processVoucherPurchase(
            { plan, code },
            { amount, recipientAccount, recipientBankCode }
        );

        if (!result.success) {
            throw new Error(`Mastercard A2A initiation failed: ${JSON.stringify(result.error)}`);
        }

        // For A2A, we might return a 'deep link' or a reference to wait for webhook
        // Since it's A2A, it might be an internal bank transfer trigger
        return result.transactionRef || result.paymentId;
    }

    async _mastercardA2AVerify(paymentId, cfg) {
        const MastercardA2A = require('../../services/mastercardA2A');
        const service = new MastercardA2A();
        const status = await service.getPaymentStatus(paymentId);

        return {
            paid: status.success && status.status === 'COMPLETED',
            reference: paymentId,
            plan: status.raw?.metadata?.plan
        };
    }

    // ── Custom Webhook ────────────────────────────────────────────────────────

    async _webhookLink(plan, amount, currency, label, cfg) {
        const callbackUrl = cfg?.credentials?.callbackUrl || process.env.PAYMENT_WEBHOOK_URL;
        if (!callbackUrl) throw new Error('Webhook payment URL not configured (PAYMENT_WEBHOOK_URL)');

        const ref = `AGT-${plan}-${Date.now()}`;
        const payload = { plan, amount, currency, label, reference: ref };
        const qs = new URLSearchParams(payload).toString();
        return `${callbackUrl}?${qs}`;
    }

    // ── Voucher management ────────────────────────────────────────────────────

    async createVoucher(params = {}) {
        const {
            type = 'access',
            value,
            resourceId,
            metadata = {}
        } = params;

        const code = this.generateSecureCode();
        const voucher = {
            code,
            type,
            value,
            resourceId,
            status: 'active',
            createdAt: new Date().toISOString(),
            expiresAt: this.calculateExpiry(type, value),
            metadata: {
                ...metadata,
                createdBy: metadata.createdBy || 'system',
                domain: this.resourceType
            },
            redemption: {
                used: false,
                usedAt: null,
                usedBy: null,
                remainingValue: value
            }
        };

        if (this.db) await this.db.saveVoucher(voucher);

        if (metadata.generateQR) {
            const QRCode = require('qrcode');
            voucher.qrCode = await QRCode.toDataURL(JSON.stringify({ code, type: this.resourceType, resource: resourceId }));
        }

        return voucher;
    }

    async redeemVoucher(code, redemptionData = {}) {
        if (!this.db) throw new Error('Database not initialized');

        // Delegate to the atomic database method which handles transactions, 
        // wallet updates, and audit logging in a single block.
        const result = await this.db.redeemVoucher(code, redemptionData);
        
        if (!result.success) {
            throw new Error(result.error || 'Voucher redemption failed');
        }

        // Use the returned voucher for provisioning context
        const voucher = result.voucher;
        const access = await this.provisionAccess(voucher, redemptionData);

        return { 
            success: true, 
            voucher: { 
                code: voucher.code, 
                type: voucher.type || 'access', 
                value: voucher.value, 
                expiresAt: voucher.expiresAt 
            }, 
            access 
        };
    }

    async provisionAccess(voucher, redemptionData = {}) {
        const provisioners = {
            network: async () => ({ username: voucher.code, password: voucher.code, profile: 'voucher' }),
            compute: async () => ({ credits: voucher.value, instanceToken: this.generateSecureCode() }),
            api: async () => ({ apiKey: this.generateSecureCode(), rateLimit: voucher.value })
        };
        const fn = provisioners[this.resourceType] || provisioners.network;
        return fn();
    }

    async validateCode(code) {
        if (!this.db) return { valid: false, reason: 'no_database' };
        const voucher = await this.db.getVoucher(code);
        if (!voucher) return { valid: false, reason: 'not_found' };
        if (voucher.redemption.used && voucher.type !== 'credits') return { valid: false, reason: 'used' };
        if (new Date() > new Date(voucher.expiresAt)) return { valid: false, reason: 'expired' };
        return { valid: true, voucher };
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    generateSecureCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const bytes = crypto.randomBytes(8);
        let code = '';
        for (let i = 0; i < 8; i++) code += chars[bytes[i] % chars.length];
        const checksum = code.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 10;
        return `${code}${checksum}`;
    }

    /**
     * Calculate voucher expiry from a plan object or legacy type string.
     *
     * New schema: calculateExpiry({ durationUnit, durationValue })
     * Legacy compat: calculateExpiry('1h' | '1d' | '1w' | '1m', optionalValue)
     */
    calculateExpiry(planOrType, legacyValue) {
        const now = new Date();

        // ── New schema path ───────────────────────────────────────────────────
        if (planOrType && typeof planOrType === 'object') {
            const { durationUnit, durationValue } = planOrType;
            if (!durationUnit || durationValue == null) return null; // unlimited
            const v = Number(durationValue) || 1;
            switch (durationUnit) {
                case 'hours': now.setHours(now.getHours() + v); break;
                case 'days': now.setDate(now.getDate() + v); break;
                case 'weeks': now.setDate(now.getDate() + v * 7); break;
                case 'months': now.setMonth(now.getMonth() + v); break;
                default: now.setDate(now.getDate() + 1);
            }
            return now.toISOString();
        }

        // ── Legacy string path (backward compat) ──────────────────────────────
        const type = planOrType;
        const value = legacyValue;
        switch (type) {
            case 'time': case '1h': now.setHours(now.getHours() + (Number(value) || 1)); break;
            case 'day': case '1d': now.setDate(now.getDate() + (Number(value) || 1)); break;
            case 'week': case '1w': now.setDate(now.getDate() + 7 * (Number(value) || 1)); break;
            case 'month': case '1m': now.setMonth(now.getMonth() + (Number(value) || 1)); break;
            default: now.setDate(now.getDate() + 1);
        }
        return now.toISOString();
    }

    // ── Enforcement ──────────────────────────────────────────────────────────

    /**
     * Start a background loop to check for expired sessions and kick them from MikroTik.
     * @param {number} intervalMs - How often to run the check (default: 5 minutes)
     */
    startReaper(intervalMs = 300000) {
        if (this._reaperInterval) return;

        console.log(`[Billing] Starting enforcement guard (interval: ${intervalMs / 1000}s)`);
        this._reaperInterval = setInterval(() => this.guardHotspot(), intervalMs);

        // Run immediately once
        this.guardHotspot().catch(err => {
            console.error('[Billing] Initial guard run failed:', err.message);
        });
    }

    stopReaper() {
        if (this._reaperInterval) {
            clearInterval(this._reaperInterval);
            this._reaperInterval = null;
        }
    }

    /**
     * Proactively sync database authorization status with MikroTik's router state.
     * Reconciles router users against DB status and enforces "disabled: true" for failures.
     */
    async guardHotspot() {
        const mikrotik = this.mikrotik || global.mikrotik;
        if (!this.db || !mikrotik) return;

        if (mikrotik.isConfigured === false) return;

        if (!mikrotik.state || !mikrotik.state.isConnected) {
            logger.debug('[Billing] Guard: configured MikroTik is not connected; skipping enforcement run');
            return;
        }

        if (mikrotik.isCircuitOpen) {
            logger.warn('[Billing] Guard: MikroTik circuit breaker is OPEN. Skipping enforcement run to avoid spam.');
            return;
        }

        try {
            // PHASE 1: Reconcile Router State (Who is currently "in")
            const userReport = await mikrotik.executeTool('users.report');
            let actionCount = 0;

            if (Array.isArray(userReport)) {
                for (const user of userReport) {
                    try {
                        // 1. System protection
                        if (!user.username) continue;
                        if (['admin', 'default', 'root'].includes(user.username.toLowerCase())) continue;

                        // 2. Resolve database context
                        const voucher = await this.db.getVoucher(user.username);
                        const dbUser = await this.db.resolveUser(user.username);

                        // 3. Evaluate domain-agnostic status
                        const status = await this.checkVoucherStatus(voucher, user, dbUser);
                        const isIdentified = !!(voucher || dbUser);

                        // If user is a registered account (not a voucher) and has no active plan, expire them
                        if (!status.expired && dbUser && !voucher) {
                            const hasActivePlan = await this.hasPlan(dbUser);
                            if (!hasActivePlan) {
                                status.expired = true;
                                status.reason = 'no_active_plan';
                            }
                        }

                        if (status.expired) {
                            logger.audit('Voucher Expired', { username: user.username, reason: status.reason });
                            logger.cyber(`[Enforcement] Expired: ${user.username} (Reason: ${status.reason})`);

                            // Kick active session
                            if (user.isActive) {
                                await mikrotik.executeTool('user.kick', { username: user.username });
                            }

                            // Disable user on router (Persistent enforcement)
                            // await mikrotik.executeTool('user.disable', { username: user.username });

                            // Mark as expired in DB
                            if (voucher && voucher.status !== 'expired') {
                                await this.db.expireVoucher(voucher.code || user.username);
                            }

                            // ── Recurring Billing Check ─────────────────────
                            if (dbUser && (voucher?.plan || dbUser.lastPlanId)) {
                                const renewed = await this._attemptAutoRenewal(
                                    dbUser, voucher, voucher?.plan || dbUser.lastPlanId, mikrotik
                                );
                                if (renewed) continue; // skip kick
                            }
                            // ────────────────────────────────────────────────

                            actionCount++;
                        } else if (user.disabled === true && isIdentified) {
                            // RECOVERY: If they have a valid plan (identified) but are disabled on router, re-enable them
                            logger.info(`[Guard] Re-enabling valid user: ${user.username}`);
                            await mikrotik.executeTool('user.enable', { username: user.username });
                            actionCount++;
                        } else if (!isIdentified && user.isActive) {
                            // OPTIONAL: Log unidentified active sessions (ghosts)
                            logger.debug(`[Guard] Unidentified active session: ${user.username} (Uptime: ${user.uptime || 'unknown'}, IP: ${user.address || 'unknown'})`);
                        }
                    } catch (userError) {
                        logger.error(`[Guard] Failed to process user ${user.username}`, { error: userError.message });
                        if (userError.message.includes('Circuit breaker is OPEN')) {
                            logger.warn('[Guard] Aborting run: Circuit breaker has tripped during processing.');
                            break; 
                        }
                    }
                }
            }

            // PHASE 2: Expired Sweep
            const expiredVouchers = await this.db.getVouchersByStatus('expired');
            if (Array.isArray(expiredVouchers)) {
                for (const v of expiredVouchers.slice(0, 50)) {
                    if (mikrotik.isCircuitOpen) break;
                    try {
                        // await mikrotik.executeTool('user.disable', { username: v.code });
                    } catch (e) { /* ignore */ }
                }
            }

            // PHASE 3: Suspended/Banned Sync
            const restrictedUsers = await this.db.getUsersByStatus(['suspended', 'banned']);
            if (Array.isArray(restrictedUsers)) {
                for (const u of restrictedUsers.slice(0, 50)) {
                    if (mikrotik.isCircuitOpen) break;
                    try {
                        await mikrotik.executeTool('user.disable', { username: u.username });
                        if (u.id || u.uid) {
                            await this.db.syncUserLifecycleGraph(u.id || u.uid, 'user.restricted', {
                                scope: {
                                    tenantId: u.tenantId,
                                    domain: u.domain,
                                    siteId: u.siteId
                                },
                                details: { status: u.status, enforcement: 'mikrotik.user.disable' }
                            });
                        }
                    } catch (e) { /* ignore */ }
                }
            }

            // PHASE 3: Active Parity Audit (Deep Reconciliation)
            // Check vouchers marked 'active' in DB to see if they SHOULD be expired
            const activeVouchers = await this.db.getVouchersByStatus('active');
            if (Array.isArray(activeVouchers)) {
                for (const v of activeVouchers.slice(0, 100)) { // Audit 100 per run
                    try {
                        const status = await this.checkVoucherStatus(v, {}, null);
                        if (status.expired) {
                            logger.info(`[Guard] Deep Audit: Mark ${v.code} as expired (${status.reason})`);
                            await this.db.expireVoucher(v.code);
                            // await mikrotik.executeTool('user.disable', { username: v.code });
                            actionCount++;
                        }
                    } catch (e) { /* ignore */ }
                }
            }

            if (actionCount > 0) {
                logger.info(`[Enforcement] Guard loop finished. Actions: ${actionCount}`);
            }
        } catch (error) {
            logger.error('[Enforcement] Guard encountered a fatal error', { error: error.message });
        }
    }

    // Alias for backward compatibility
    async reapExpiredVouchers() {
        return this.guardHotspot();
    }

    /**
     * Dedicated administrative report to reconcile "ghost" sessions.
     * Identifies sessions active/existing on MikroTik but not found in Firebase.
     * @returns {Promise<Object>} Report containing ghost users, valid users, and mismatched users.
     */
    async auditGhostSessions() {
        const mikrotik = this.mikrotik || global.mikrotik;
        if (!this.db || !mikrotik) throw new Error("Database or MikroTik not connected.");

        if (!mikrotik.state || !mikrotik.state.isConnected) {
            throw new Error("MikroTik not connected.");
        }

        const report = {
            ghosts: [],
            valid: [],
            totalChecked: 0,
            timestamp: new Date().toISOString()
        };

        try {
            // Get all hotspot users from the router
            const userReport = await mikrotik.executeTool('users.report');
            
            if (Array.isArray(userReport)) {
                report.totalChecked = userReport.length;
                logger.info(`[Audit] Fetched ${userReport.length} users from MikroTik. Reconciling with database...`);

                let processed = 0;
                for (const user of userReport) {
                    processed++;
                    if (processed % 100 === 0) {
                        logger.info(`[Audit] Processed ${processed}/${userReport.length} users...`);
                    }

                    if (!user.username) continue;
                    // Skip system accounts
                    if (['admin', 'default', 'root'].includes(user.username.toLowerCase())) {
                        continue;
                    }

                    // Check if they exist in the database
                    const voucher = await this.db.getVoucher(user.username).catch(() => null);
                    const dbUser = await this.db.resolveUser(user.username).catch(() => null);

                    if (!voucher && !dbUser) {
                        // Ghost!
                        report.ghosts.push({
                            username: user.username,
                            profile: user.profile || 'unknown',
                            uptime: user.uptime,
                            bytesTotal: user.bytesTotal,
                            disabled: user.disabled,
                            isActive: user.isActive
                        });
                    } else {
                        report.valid.push(user.username);
                    }
                }
            }
            
            logger.info(`[Audit] Ghost sessions audit completed. Found ${report.ghosts.length} ghosts out of ${report.totalChecked} users.`);
            return report;
        } catch (error) {
            logger.error('[Audit] Failed to run ghost sessions audit', { error: error.message });
            throw error;
        }
    }

 /**
  * Domain-agnostic status check for a voucher or user.
  * Evaluates time, data, and role-based limits.
  * Uses Math.min logic to enforce the most restrictive limit.
  */
async checkVoucherStatus(voucher, usage = {}, user = null) {
    const now = new Date();
    const results = { expired: false, reason: null };

    // 0. Role-based bypass (Admins and Resellers have different enforcement)
    if (user && user.role === 'admin') return results;
    if (voucher && voucher.createdBy === 'admin' && !voucher.expiresAt) return results;

    // 1. Check Time Expiration (Explicit expiry date)
    if (voucher && voucher.expiresAt) {
        const expiry = new Date(voucher.expiresAt);
        if (now > expiry) {
            return { expired: true, reason: 'time_expired' };
        }
    }

    // 2. Check Data Quota (Router-reported usage vs Plan limit)
    // usage.limitBytesTotal is the authoritative cap set on the router
    if (usage.limitBytesTotal && usage.bytesTotal >= usage.limitBytesTotal) {
        return { expired: true, reason: 'data_depleted' };
    }

    // 3. Check Uptime Limit (Router-reported uptime vs limit-uptime)
    if (usage.limitUptime && usage.uptime >= usage.limitUptime) {
        return { expired: true, reason: 'uptime_limit_reached' };
    }

    // 4. Domain-Agnostic "Math.min" enforcement
    // If both time and data are set, the reaper identifies the first breach.
    // This effectively implements Math.min(expiry, dataLimit) enforcement.
    const hasTimeLimit = !!(voucher?.expiresAt);
    const hasDataLimit = !!(usage.limitBytesTotal && usage.limitBytesTotal > 0);

    const timeRemaining = hasTimeLimit ? (new Date(voucher.expiresAt) - now) : Infinity;
    const dataRemaining = hasDataLimit ? (usage.limitBytesTotal - usage.bytesTotal) : Infinity;

    if ((hasTimeLimit && timeRemaining <= 0) || (hasDataLimit && dataRemaining <= 0)) {
        return {
            expired: true,
            reason: (hasTimeLimit && timeRemaining <= 0) ? 'time_expired' : 'data_depleted'
        };
    }

    // 5. Check Credits (for non-hotspot domains)
    if (this.resourceType === 'compute' || this.resourceType === 'api') {
        let credits = 0;
        if (user && this.db) {
            // Use getWallet as the single source of truth for balances
            const wallet = await this.db.getWallet(user.id || user.uid);
            credits = wallet.balance || 0;
        } else {
            credits = Number(voucher?.redemption?.remainingValue ?? voucher?.value ?? user?.credits ?? 0);
        }

        if (credits <= 0) {
            return { expired: true, reason: 'credits_depleted' };
        }
    }

    return results;
}

    /**
     * High-level check if a user is currently authorized for access.
     */
    async hasPlan(userId) {
    const user = typeof userId === 'string' ? await this.db.getUser(userId) : userId;
    if (!user) return false;

    // Admins always have access
    if (user.role === 'admin') return true;

    // Check for active subscriptions
    if (user.subscriptions && Array.isArray(user.subscriptions)) {
        const now = new Date();
        const active = user.subscriptions.find(s => 
            (s.status === 'active' || s.status === 'unused') && 
            (!s.expiresAt || new Date(s.expiresAt) > now)
        );
        if (active) return true;
    }

    // Check for valid wallet credits
    if (this.db) {
        const wallet = await this.db.getWallet(user.id || user.uid);
        if (wallet.balance > 0) return true;
    } else if (user.credits > 0) {
        return true;
    }

    return false;
}

_getPlanAmount(planId, cfg) {
    // Look up price from config plans by name or mikrotikProfile
    const plans = Array.isArray(cfg?.plans)
        ? cfg.plans
        : Object.values(cfg?.plans || {});   // tolerate old object-map shape
    const found = plans.find(p =>
        p.name === planId ||
        p.mikrotikProfile === planId ||
        p.id === planId
    );
    return found?.price || Number(process.env.PAYMENT_DEFAULT_AMOUNT) || 10;
}

_readConfigFile() {
    try {
        const { getConfig } = require('./config');
        return getConfig();
    } catch (_) {
        return null;
    }
}

    // ── Auto-Renewal Engine ──────────────────────────────────────────────────

    /**
     * Attempt to auto-renew a user's plan with exponential backoff.
     * Emits 'billing:renewal:success' or 'billing:renewal:failed'.
     * @returns {boolean} true if renewed (caller should skip kick)
     */
    async _attemptAutoRenewal(dbUser, voucher, planId, mikrotik) {
        const cfg  = this.config.payments || this._readConfigFile();
        const cost = this._getPlanAmount(planId, cfg);
        const uid  = dbUser.id || dbUser.uid;
        const username = dbUser.username || voucher?.code;

        let wallet;
        try {
            wallet = await this.db.getWallet(uid);
        } catch (e) {
            logger.warn(`[Billing] Could not fetch wallet for ${username}: ${e.message}`);
            return false;
        }

        // Emit low-balance warning regardless of renewal outcome
        if (wallet && wallet.balance < cost) {
            this.emit('billing:lowBalance', { username, userId: uid, balance: wallet.balance, cost, planId });
            logger.warn(`[Billing] Low balance: ${username} has ${wallet.balance} < ${cost} (plan: ${planId})`);
            return false;
        }

        // Exponential backoff: up to 3 attempts
        const MAX_ATTEMPTS = 3;
        let lastErr;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                logger.info(`[Billing] Auto-renew attempt ${attempt}/${MAX_ATTEMPTS}: ${username} (plan: ${planId}, cost: ${cost})`);

                await this.db.deductCredits(uid, cost, `Auto-renewal: ${planId} (attempt ${attempt})`);
                await mikrotik.executeTool('user.enable', { username });

                if (voucher) {
                    const newExpiry = this.calculateExpiry(planId);
                    await this.db.updateVoucher(voucher.code, {
                        status:     'active',
                        expiresAt:  newExpiry,
                        redemption: { used: true, usedAt: new Date().toISOString(), remainingValue: 0 }
                    });
                }

                // Record in audit trail
                await this.db.logAuditTrail?.('auto-renewal', 'billing.renew', {
                    username, planId, cost, attempt
                }).catch(() => {});

                this.emit('billing:renewal:success', { username, userId: uid, planId, cost, attempt });
                logger.info(`[Billing] ✅ Auto-renewal success: ${username} (${planId})`);
                return true;

            } catch (err) {
                lastErr = err;
                logger.warn(`[Billing] Auto-renew attempt ${attempt} failed for ${username}: ${err.message}`);
                if (attempt < MAX_ATTEMPTS) {
                    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
                }
            }
        }

        this.emit('billing:renewal:failed', { username, userId: uid, planId, cost, error: lastErr?.message });
        logger.error(`[Billing] ❌ Auto-renewal failed after ${MAX_ATTEMPTS} attempts: ${username}`);
        return false;
    }

    /**
     * Public method: initiate a mobile money STK push for a user.
     * @param {{ provider, phone, amount, plan }} opts
     */
    async initiatePayment({ provider, phone, amount, plan }) {
        const cfg = this.config.payments || this._readConfigFile();
        return this._mpesaInitiateSTK(phone, amount, plan, cfg, provider);
    }

} // end class UniversalBilling

export default UniversalBilling;
