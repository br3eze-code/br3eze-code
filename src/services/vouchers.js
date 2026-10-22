import { randomInt } from 'node:crypto';
import eventBus from '../core/eventBus.js';
import { getConfig } from '../core/config.js';
import { getDatabase } from '../core/database.js';

class VoucherService {
  constructor({ networkAdapter = null } = {}) {
    this.generated = new Map();
    this.networkAdapter = networkAdapter;
  }

  get _config() {
    const config = getConfig();
    return config.vouchers || config.tools?.voucher || {
      prefix: 'STAR',
      format: 'XXXX-XXXX',
      alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    };
  }

  get _validPlans() {
    const config = getConfig();
    const plans = new Set(['default', '1hour', '1day', '1week', '7day', '30day', '1month']);
    for (const plan of config.tools?.mikrotik?.profiles || []) {
      if (plan.name) plans.add(plan.name);
      if (plan.mikrotikProfile) plans.add(plan.mikrotikProfile);
    }
    for (const plan of config.plans || []) {
      if (plan.name) plans.add(plan.name);
      if (plan.mikrotikProfile) plans.add(plan.mikrotikProfile);
    }
    return plans;
  }

  _resolvePlan(plan) {
    const match = [...this._validPlans].find(
      (candidate) => candidate.toLowerCase() === String(plan).toLowerCase(),
    );
    if (!match) throw new Error(`Invalid plan '${plan}'. Available: ${[...this._validPlans].join(', ')}`);
    return match;
  }

  _randomPart(length, alphabet) {
    if (typeof alphabet !== 'string' || alphabet.length < 2) {
      throw new Error('Voucher alphabet must contain at least two characters');
    }
    return Array.from({ length }, () => alphabet[randomInt(0, alphabet.length)]).join('');
  }

  generateCode() {
    const config = this._config;
    const alphabet = config.alphabet || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const format = config.format || 'XXXX-XXXX';
    const prefix = config.prefix || 'STAR';
    const body = format.replace(/X+/g, (match) => this._randomPart(match.length, alphabet));
    return prefix ? `${prefix}-${body}` : body;
  }

  async generate(plan = 'default') {
    const resolvedPlan = this._resolvePlan(plan);
    const db = await getDatabase();
    let voucher = null;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = this.generateCode();
      if (await db.getVoucher(code)) continue;

      const createdAt = new Date().toISOString();
      voucher = {
        code,
        plan: resolvedPlan,
        status: 'active',
        used: false,
        createdAt,
        createdBy: 'voucher-service',
      };

      if (typeof db.createVoucher === 'function') {
        await db.createVoucher(code, voucher);
      } else if (typeof db.saveVoucher === 'function') {
        await db.saveVoucher(voucher);
      } else {
        throw new Error('Voucher persistence adapter does not support createVoucher/saveVoucher');
      }

      this.generated.set(code, voucher);
      eventBus.emit('voucher.created', { code, plan: resolvedPlan, createdAt });
      return code;
    }

    throw new Error('Unable to allocate a unique voucher code after 10 attempts');
  }

  async createVoucher(plan = 'default') {
    const resolvedPlan = this._resolvePlan(plan);
    const code = await this.generate(resolvedPlan);
    let provisioning = null;

    if (this.networkAdapter?.provisionVoucher) {
      try {
        provisioning = await this.networkAdapter.provisionVoucher({
          username: code,
          password: code,
          plan: resolvedPlan,
        });
      } catch (error) {
        eventBus.emit('voucher.provisioning-failed', {
          code,
          plan: resolvedPlan,
          message: error.message,
        });
      }
    }

    return {
      username: code,
      password: code,
      profile: resolvedPlan,
      loginUrl: provisioning?.loginUrl || '',
      createdAt: this.generated.get(code)?.createdAt || new Date().toISOString(),
    };
  }

  async create(plan = 'default') {
    const code = await this.generate(plan);
    return this.generated.get(code);
  }

  async updateVoucher(code, plan = 'default') {
    if (!code) throw new Error('Voucher code is required');
    const resolvedPlan = this._resolvePlan(plan);
    const db = await getDatabase();
    const existing = await db.getVoucher(code);
    if (!existing) throw new Error(`Voucher '${code}' not found in database.`);
    if (existing.used) throw new Error('Used vouchers cannot be updated');

    const updates = { plan: resolvedPlan, status: 'active', updatedAt: new Date().toISOString() };
    if (typeof db.updateVoucher !== 'function') throw new Error('Voucher persistence adapter does not support updateVoucher');
    await db.updateVoucher(code, updates);
    this.generated.set(code, { ...existing, ...updates });
    eventBus.emit('voucher.updated', { code, plan: resolvedPlan, updatedAt: updates.updatedAt });
    return db.getVoucher(code);
  }

  async redeem(code, user) {
    if (!code || !user) throw new Error('code and user are required');
    const db = await getDatabase();

    // Prefer an adapter-level atomic redemption when available to prevent two
    // concurrent requests from redeeming the same voucher.
    if (typeof db.redeemVoucher === 'function') {
      const redeemed = await db.redeemVoucher(code, user);
      this.generated.set(code, redeemed);
      eventBus.emit('voucher.redeemed', { code, user, redeemedAt: new Date().toISOString() });
      return redeemed;
    }

    const voucher = await db.getVoucher(code);
    if (!voucher) throw new Error('Invalid voucher');
    if (voucher.used || voucher.status === 'used') throw new Error('Already used');
    if (typeof db.updateVoucher !== 'function') throw new Error('Voucher persistence adapter does not support updateVoucher');

    const updates = {
      used: true,
      user,
      redeemedByUsername: user,
      status: 'used',
      redeemedAt: new Date().toISOString(),
    };
    await db.updateVoucher(code, updates);
    const result = { ...voucher, ...updates };
    this.generated.set(code, result);
    eventBus.emit('voucher.redeemed', { code, user, redeemedAt: updates.redeemedAt });
    return result;
  }
}

export default new VoucherService();
export { VoucherService };
