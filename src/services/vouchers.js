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
