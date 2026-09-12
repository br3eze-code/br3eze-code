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
}

export default new VoucherService();
