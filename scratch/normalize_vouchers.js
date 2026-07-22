require('dotenv').config();
const { getDatabase } = require('../src/core/database.js');

async function normalizeVouchers() {
    try {
        const db = await getDatabase();
        // Fetch a large number of recent vouchers
        const vouchers = await db.getVouchers({ limit: 5000 });
        let fixedCount = 0;

        for (const voucher of vouchers) {
            let updates = {};
            let needsUpdate = false;

            if (!voucher.plan) {
                // Heuristics based on value or duration
                if (voucher.value === 0.5 || voucher.amount === 0.5) {
                    updates.plan = '1Hour';
                    updates.durationUnit = 'hours';
                    updates.durationValue = 1;
                    needsUpdate = true;
                } else if (voucher.value === 1 || voucher.amount === 1) {
                    updates.plan = '1Day';
                    updates.durationUnit = 'days';
                    updates.durationValue = 1;
                    needsUpdate = true;
                } else if (voucher.value === 3 || voucher.amount === 3) {
                    updates.plan = '7Day';
                    updates.durationUnit = 'days';
                    updates.durationValue = 7;
                    needsUpdate = true;
                } else if (voucher.value === 5 || voucher.amount === 5) {
                    updates.plan = '30Day';
                    updates.durationUnit = 'days';
                    updates.durationValue = 30;
                    needsUpdate = true;
                } else if (voucher.durationValue && voucher.durationUnit) {
                   // deduce plan from duration if plan is missing
                   if (voucher.durationValue == 1 && voucher.durationUnit == 'hours') updates.plan = '1Hour';
                   if (voucher.durationValue == 1 && voucher.durationUnit == 'days') updates.plan = '1Day';
                   if (voucher.durationValue == 7 && voucher.durationUnit == 'days') updates.plan = '7Day';
                   if (voucher.durationValue == 30 && voucher.durationUnit == 'days') updates.plan = '30Day';
                   if (updates.plan) needsUpdate = true;
                }
            }

            if (needsUpdate) {
                console.log(`Fixing voucher ${voucher.id} with updates:`, updates);
                await db.updateVoucher(voucher.id, updates);
                fixedCount++;
            }
        }
        console.log(`Normalization complete. Fixed ${fixedCount} vouchers.`);
        await db.close();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

normalizeVouchers();
