const { printVoucher } = require('./src/core/printer');
const { getDatabase } = require('./src/core/database');
const { getConfig } = require('./src/core/config');
const dotenv = require('dotenv');

dotenv.config();

async function testPrint() {
    console.log('--- Testing Voucher Printing ---');
    
    const db = await getDatabase();
    const vouchers = await db.getVouchers(1);
    
    if (vouchers.length === 0) {
        console.log('❌ No vouchers found in database to print.');
        return;
    }
    
    const v = vouchers[0];

    // Map DB schema → printVoucher API (mirrors printExistingVoucher in voucher.js)
    const config = getConfig();
    const code = v.code || v.id;
    const planName = v.planName || v.plan || 'Default';
    const host = config.mikrotik?.ip || config.adapters?.mikrotik?.host || '192.168.88.1';
    const loginUrl = v.loginUrl || `http://${host}/login.html?code=${code}`;

    console.log(`Printing Voucher: ${code}  plan=${planName}  url=${loginUrl}`);

    try {
        const result = await printVoucher({
            username: code,
            password: code,
            profile:  planName,
            loginUrl: loginUrl,
            duration: v.durationValue ? `${v.durationValue}${v.durationUnit || ''}` : (v.duration || null),
            expires:  v.expiresAt || null,
        });
        if (result.success) {
            console.log(`✅ SUCCESS: Voucher printed via ${result.interface}`);
        } else {
            console.log(`❌ FAILED: ${result.error || 'Unknown error'}`);
        }
    } catch (err) {
        console.error(`❌ ERROR: ${err.message}`);
    }
}

testPrint();
