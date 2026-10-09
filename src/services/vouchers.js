<<<<<<< HEAD
import { randomBytes } from 'node:crypto';
import { getDatabase } from '../core/database.js';

class VoucherService {
    generateCode() {
        // 6 bytes -> 12 hex characters. Cryptographic randomness prevents
        // predictable voucher issuance and is portable across Node versions.
        return `AG-${randomBytes(6).toString('hex').toUpperCase()}`;
    }

    async create(plan) {
        const db = await getDatabase();
        let code;
        let voucher;

        // Protect the persistence layer from the (very unlikely) random-code
        // collision rather than relying on randomness alone for uniqueness.
        for (let attempt = 0; attempt < 5; attempt += 1) {
            code = this.generateCode();
            const existing = await db.getVoucher(code).catch(() => null);
            if (existing) continue;

            voucher = {
                code,
                plan,
                used: false,
                createdAt: Date.now()
            };
            await db.saveVoucher(voucher);
            return voucher;
        }

        throw new Error('Unable to allocate a unique voucher code');
    }

    async redeem(code, username) {
        const db = await getDatabase();
        const voucher = await db.getVoucher(code);

        if (!voucher) throw new Error('Invalid voucher');
        if (voucher.used) throw new Error('Already used');

        const updates = {
            used: true,
            user: username,
            redeemedByUsername: username,
            status: 'used'
        };
        await db.updateVoucher(code, updates);

        return { ...voucher, ...updates };
=======
import eventBus from '../core/eventBus.js';
import { getConfig } from '../core/config.js';
import crypto from 'node:crypto';
import { getDatabase } from '../core/database.js';

class VoucherService {
  constructor() {
    this.generated = new Map();
  }

  get _config() {
    const config = getConfig();
    return config.vouchers || config.tools?.voucher || { prefix: 'STAR', format: 'XXXX-XXXX', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' };
  }
  get _validPlans() {
    const config = getConfig();
    const plans = new Set(['default', '1hour', '1day', '1week', '30day', '7day', '1month']);
    for (const p of config.tools?.mikrotik?.profiles || []) { if (p.name) plans.add(p.name); if (p.mikrotikProfile) plans.add(p.mikrotikProfile); }
    for (const p of config.plans || []) { if (p.name) plans.add(p.name); if (p.mikrotikProfile) plans.add(p.mikrotikProfile); }
    return plans;
  }
  async generate(plan = 'default') {
    const valid = this._validPlans;
    const match = [...valid].find((p) => p.toLowerCase() === String(plan).toLowerCase());
    if (!match) throw new Error(`Invalid plan '${plan}'. Available: ${[...valid].join(', ')}`);
    const cfg = this._config; const chars = cfg.alphabet || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part = (len) => Array.from({ length: len }, () => chars[crypto.randomInt(0, chars.length)]).join('');
    const format = cfg.format || 'XXXX-XXXX'; const prefix = cfg.prefix || 'STAR';
    const db = await getDatabase(); let code; let attempts = 0;
    while (attempts++ < 10) {
      code = `${prefix ? `${prefix}-` : ''}${format.replace(/X+/g, (m) => part(m.length))}`;
      if (!(await db.getVoucher(code))) break;
    }
    if (!code) throw new Error('Unable to generate a unique voucher');
    const createdAt = new Date().toISOString();
    this.generated.set(code, { code, plan: match, status: 'active', used: false, createdAt });
    await db.createVoucher(code, {
      plan: match,
      status: 'active',
      used: false,
      createdAt,
      createdBy: 'voucher-service'
    });
    eventBus.emit('voucher.created', { code, plan: match, createdAt });
    return code;
  }
  async createVoucher(plan = 'default') {
    const code = await this.generate(plan); const password = code;
    let loginUrl = '';
    if (global.mikrotik?.isConnected) {
      try { loginUrl = await global.mikrotik.executeTool('user.add', { username: code, password, profile: plan }); }
      catch (err) { console.error(`[Voucher] provisioning failed for ${code}: ${err.message}`); }
    }
    return { username: code, password, profile: plan, loginUrl: loginUrl || `http://hotspot.local/login?username=${code}&password=${password}`, createdAt: new Date().toISOString() };
  }
  async updateVoucher(code, plan = 'default') {
    const db = await getDatabase(); const existing = await db.getVoucher(code);
    if (!existing) throw new Error(`Voucher '${code}' not found in database.`);
    if (global.mikrotik?.isConnected) {
      try { await global.mikrotik.executeTool('user.edit', { username: code, profile: plan }); } catch (err) { console.error(`[Voucher] update failed for ${code}: ${err.message}`); }
>>>>>>> origin/main
    }
    await db.updateVoucher(code, { plan, status: 'active', updatedAt: new Date().toISOString() });
    return db.getVoucher(code);
  }
  async create(plan = 'default') { return this.createVoucher(plan); }
  async redeem(code, user) {
    if (!code || !user) throw new Error('code and user are required');
    const cached = this.generated.get(code);
    if (cached) {
      if (cached.used) throw new Error('Already used');
      const updates = { used: true, user, redeemedByUsername: user, status: 'used' };
      this.generated.set(code, { ...cached, ...updates });
      eventBus.emit('voucher.redeemed', { code, user, redeemedAt: new Date().toISOString() });
      const db = await getDatabase();
      if (typeof db.updateVoucher === 'function') await db.updateVoucher(code, updates);
      return { ...cached, ...updates };
    }
    const db = await getDatabase();
    const voucher = await db.getVoucher(code);
    if (!voucher) throw new Error('Invalid voucher'); if (voucher.used) throw new Error('Already used');
    const updates = { used: true, user, redeemedByUsername: user, status: 'used' };
    this.generated.set(code, { ...voucher, ...updates });
    if (typeof db.updateVoucher === 'function') await db.updateVoucher(code, updates);
    eventBus.emit('voucher.redeemed', { code, user, redeemedAt: new Date().toISOString() });
    return { ...voucher, ...updates };
  }
}
export default new VoucherService();
