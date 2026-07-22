/**
 * FinancialController — AgentOS revenue reporting and transaction auditing
 * Aligned with 36.js (monolith) functions.
 */
import { logger } from './logger.js';

const PRICING = {
    '1Hour': 0.50,
    '1Day': 1.00,
    '7Day': 3.00,
    '30Days': 5.00,
    'default': 10.00,
};

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

class FinancialController {
    constructor(deps = {}) {
        this.database = deps.database || deps.db;
        this.mastercard = deps.mastercard || null;
        this.pricing = { ...PRICING, ...(deps.pricing || {}) };
    }

    _price(plan) {
        // Case-insensitive lookup for plan pricing to ensure robustness
        const planKey = Object.keys(this.pricing).find(k => k.toLowerCase() === (plan || '').toLowerCase());
        return this.pricing[planKey] ?? this.pricing.default;
    }

    // ── Revenue Report ────────────────────────────────────────────────────────

    async getRevenueReport() {
        if (!this.database) return { error: 'Database not available' };

        const vouchers = await this.database.getRecentVouchers(10_000);
        const startOfDay = new Date(new Date().toDateString()).getTime();

        let total = 0, today = 0, pending = 0;
        const plans = {};

        for (const v of vouchers) {
            const price = this._price(v.plan);
            total += price;
            if (new Date(v.createdAt).getTime() >= startOfDay) {
                today += price;
            }
            if (!v.used) pending += price;
            plans[v.plan] = (plans[v.plan] || 0) + 1;
        }

        return {
            currency: 'USD',
            grossRevenue: total.toFixed(2),
            todayRevenue: today.toFixed(2),
            potentialRevenue: pending.toFixed(2),
            topPlan: Object.entries(plans).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
            totalVouchers: vouchers.length,
        };
    }

    // ── 7-Day Trends ──────────────────────────────────────────────────────────

    async getTrends() {
        if (!this.database) return { error: 'Database not available' };

        const vouchers = await this.database.getRecentVouchers(10_000);
        const now = Date.now();

        // 7-day daily buckets
        const days = Array.from({ length: 7 }, (_, i) => {
            const start = now - (6 - i) * DAY_MS;
            const end = start + DAY_MS;
            const label = new Date(start).toISOString().slice(5, 10);
            const created = vouchers.filter(v => {
                const t = new Date(v.createdAt).getTime();
                return t >= start && t < end;
            });
            const revenue = created.reduce((s, v) => s + this._price(v.plan), 0);
            return { label, count: created.length, revenue: revenue.toFixed(2) };
        });

        // Hourly velocity (last 24h)
        const hourly = Array.from({ length: 24 }, (_, h) => {
            const start = now - (23 - h) * HOUR_MS;
            const end = start + HOUR_MS;
            return vouchers.filter(v => {
                const t = new Date(v.createdAt).getTime();
                return t >= start && t < end;
            }).length;
        });

        // Plan mix
        const planMix = {};
        vouchers.forEach(v => { planMix[v.plan] = (planMix[v.plan] || 0) + 1; });

        // Churn signal
        const churnAtRisk = vouchers.filter(v => {
            if (v.used || !v.expiresAt || !v.createdAt) return false;
            const window = new Date(v.expiresAt).getTime() - new Date(v.createdAt).getTime();
            const elapsed = now - new Date(v.createdAt).getTime();
            return window > 0 && elapsed / window > 0.9;
        }).length;

        // Week-on-week growth
        const thisWeek = days.slice(4).reduce((s, d) => s + parseFloat(d.revenue), 0);
        const lastWeek = days.slice(0, 3).reduce((s, d) => s + parseFloat(d.revenue), 0);
        const wow = lastWeek > 0 ? (((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1) : null;

        return { days, hourly, planMix, churnAtRisk, weekOnWeekGrowth: wow };
    }

    // ── Payment Verification ──────────────────────────────────────────────────

    async verifyPayment(paymentId) {
        if (!this.mastercard) {
            logger.warn('FinancialController: Mastercard service not configured');
            return { status: 'unknown', error: 'Service unavailable' };
        }
        logger.info(`FinancialController: verifying payment ${paymentId}`);
        return await this.mastercard.getPaymentStatus(paymentId);
    }

    // ── Audit Trail ───────────────────────────────────────────────────────────

    async auditTrail(limit = 100) {
        if (!this.database) return [];
        return this.database.getAuditLog(limit);
    }

    /**
     * Build a real, itemised invoice from an order/line-item payload and
     * persist it when a database is available.
     *
     * @param {object} data
     * @param {string} [data.userId]
     * @param {string} [data.orderId]
     * @param {Array<{description,qty,unitPrice}>} [data.lineItems]
     * @param {string} [data.currency='USD']
     * @param {number} [data.shipping=0]
     * @param {number} [data.taxRate=0]  fractional, e.g. 0.15
     * @param {object} [data.billingAddress]
     */
    async generateInvoice(data = {}) {
        const currency = (data.currency || 'USD').toUpperCase();
        const items = (data.lineItems || []).map((li) => {
            const qty = Number(li.qty) || 1;
            const unitPrice = Number(li.unitPrice ?? li.price) || 0;
            return {
                description: li.description || li.name || 'Item',
                qty,
                unitPrice: +unitPrice.toFixed(2),
                amount: +(qty * unitPrice).toFixed(2),
            };
        });

        const subtotal = +items.reduce((s, li) => s + li.amount, 0).toFixed(2);
        const shipping = +(Number(data.shipping) || 0).toFixed(2);
        const tax = +(subtotal * (Number(data.taxRate) || 0)).toFixed(2);
        const total = +(subtotal + shipping + tax).toFixed(2);

        const invoice = {
            id: `INV-${Date.now().toString(36).toUpperCase()}`,
            number: data.number || `INV-${Date.now().toString(36).toUpperCase()}`,
            userId: data.userId || null,
            orderId: data.orderId || null,
            lineItems: items,
            subtotal,
            shipping,
            tax,
            total,
            currency,
            billingAddress: data.billingAddress || null,
            status: data.status || (total > 0 ? 'unpaid' : 'paid'),
            createdAt: new Date().toISOString(),
        };

        logger.info(`FinancialController: invoice ${invoice.id} — ${items.length} item(s), ${currency} ${total}`);

        // Persist when a database is wired (best-effort; never blocks the caller).
        if (this.database && typeof this.database.saveInvoice === 'function') {
            try { await this.database.saveInvoice(invoice); }
            catch (e) { logger.warn(`Invoice persistence failed: ${e.message}`); }
        }
        return invoice;
    }
}

export default FinancialController;
