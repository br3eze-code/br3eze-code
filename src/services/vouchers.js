import { getDatabase } from '../core/database.js';

// src/services/vouchers.js
class VoucherService {
    generateCode() {
        return "AG-" + Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    async create(plan) {
        const code = this.generateCode();
        const voucher = {
            code,
            plan,
            used: false,
            createdAt: Date.now()
        };

        const db = await getDatabase();
        await db.saveVoucher(voucher);
        return voucher;
    }

    async redeem(code, username) {
        const db = await getDatabase();
        const voucher = await db.getVoucher(code);

        if (!voucher) throw new Error("Invalid voucher");
        if (voucher.used) throw new Error("Already used");

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
