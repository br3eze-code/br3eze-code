const { printVoucher } = require('./src/core/printer');
const { getDatabase } = require('./src/core/database');
const { getConfig } = require('./src/core/config');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();

async function createAndPrint() {
    console.log('--- Creating and Printing Voucher ---');
    try {
        const db = await getDatabase();
        const code = 'STAR-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        const planName = '1 Hour';

        // Create the voucher
        await db.createVoucher(code, {
            value: 1,
            plan: planName,
            planName: planName,
            duration: '1h',
            durationValue: 1,
            durationUnit: 'h'
        });
        console.log(`✅ Successfully created voucher ${code}`);

        const config = getConfig();
        const host = config.mikrotik?.ip || config.adapters?.mikrotik?.host || '192.168.88.1';
        const loginUrl = `http://${host}/login.html?code=${code}`;

        console.log(`Printing Voucher: ${code}  plan=${planName}  url=${loginUrl}`);

        const result = await printVoucher({
            username: code,
            password: code,
            profile: planName,
            loginUrl: loginUrl,
            duration: '1h',
            expires: Date.now() + 3600000,
            price: 1,
            currency: '$'
        });

        if (result.success) {
            console.log(`✅ SUCCESS: Voucher printed via ${result.interface}`);
        } else {
            console.log(`❌ FAILED: ${result.error || 'Unknown error'}`);
        }
        process.exit(0);
    } catch (err) {
        console.error(`❌ ERROR: ${err.message}`);
        process.exit(1);
    }
}

createAndPrint();
