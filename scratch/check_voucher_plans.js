'use strict';
const { getDatabase } = require('../src/core/database');

async function check() {
    const db = await getDatabase();
    console.log('--- Voucher Plan References ---');
    const vouchers = await db.getVouchers({ limit: 50 });
    const planCounts = {};
    for (const v of vouchers) {
        planCounts[v.plan] = (planCounts[v.plan] || 0) + 1;
    }
    console.log(JSON.stringify(planCounts, null, 2));
}

check().catch(console.error);
