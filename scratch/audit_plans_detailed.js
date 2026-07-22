'use strict';
const { getDatabase } = require('../src/core/database');

async function check() {
    const db = await getDatabase();
    console.log('--- Current Plans (Detailed) ---');
    const plans = await db.getPlans(false);
    for (const p of plans) {
        console.log(JSON.stringify(p, null, 2));
    }
}

check().catch(console.error);
