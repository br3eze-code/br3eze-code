'use strict';
/**
 * Load test for voucher redemption flow.
 * Tests database consistency and MikroTik provisioning under concurrency.
 */

const { getDatabase } = require('./src/core/database');
const { getManager: getMikroTik } = require('./src/core/mikrotik');
const { logger } = require('./src/core/logger');

async function runLoadTest(concurrency = 5) {
    console.log(`🚀 Starting load test with concurrency: ${concurrency}`);
    
    const db = await getDatabase();
    const mikrotik = getMikroTik();
    
    // 1. Create test vouchers
    console.log('--- Phase 1: Creating Vouchers ---');
    const codes = [];
    for (let i = 0; i < concurrency; i++) {
        const code = `TEST-LOAD-${i}-${Math.random().toString(36).substring(7).toUpperCase()}`;
        await db.createVoucher(code, { plan: '1hour', test: true });
        codes.push(code);
        process.stdout.write('.');
    }
    console.log(`\n✅ Created ${concurrency} test vouchers.`);

    // 2. Concurrently redeem vouchers
    console.log('--- Phase 2: Concurrent Redemption ---');
    const start = Date.now();
    const results = await Promise.allSettled(codes.map((code, i) => {
        const user = `user_load_${i}`;
        return (async () => {
            // Simulate redemption flow
            const voucher = await db.getVoucher(code);
            if (!voucher) throw new Error(`Voucher ${code} not found`);
            if (voucher.used) throw new Error(`Voucher ${code} already used`);
            
            // provisioning
            if (mikrotik.isConnected) {
                await mikrotik.addHotspotUser(user, user, voucher.plan);
            }
            
            // update db
            await db.redeemVoucher(code, { username: user, ip: '127.0.0.1' });
            return { code, user };
        })();
    }));

    const duration = Date.now() - start;
    const successes = results.filter(r => r.status === 'fulfilled').length;
    const failures = results.filter(r => r.status === 'rejected').length;

    console.log('\n--- Load Test Results ---');
    console.log(`Successes: ${successes}`);
    console.log(`Failures:  ${failures}`);
    console.log(`Duration:  ${duration}ms`);
    console.log(`Average:   ${(duration / concurrency).toFixed(2)}ms/req`);

    if (failures > 0) {
        console.error('Errors encountered:');
        results.forEach((r, i) => {
            if (r.status === 'rejected') console.error(`- Req ${i}: ${r.reason.message}`);
        });
    }

    // 3. Cleanup
    console.log('--- Phase 3: Cleanup ---');
    for (let i = 0; i < concurrency; i++) {
        const code = codes[i];
        const user = `user_load_${i}`;
        await db.deleteVoucher(code);
        if (mikrotik.isConnected) {
            await mikrotik.removeHotspotUser(user).catch(() => {});
        }
    }
    console.log('✅ Cleanup complete.');
}

// Run it if called directly
if (require.main === module) {
    runLoadTest(parseInt(process.argv[2]) || 10)
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Load test fatal error:', err);
            process.exit(1);
        });
}
