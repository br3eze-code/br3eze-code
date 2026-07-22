'use strict';
const { getDatabase } = require('../src/core/database');

async function check() {
    const db = await getDatabase();
    console.log('--- Current Plans ---');
    const plans = await db.getPlans(false);
    for (const p of plans) {
        const expectedHash = db.hashPlanId(p.name);
        console.log(`ID: ${p.id.padEnd(20)} | Name: ${p.name.padEnd(15)} | Expected Hash: ${expectedHash} | Match: ${p.id === expectedHash}`);
    }
}

check().catch(console.error);
