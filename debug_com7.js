
const { printVoucher } = require('./src/core/printer');
const { logger } = require('./src/core/logger');

const voucherData = {
    username: 'DEBUG-COM7',
    password: 'PASSWORD',
    profile: 'Debug Plan',
    duration: 'N/A',
    loginUrl: 'http://192.168.88.1'
};

async function run() {
    console.log('--- Testing COM7 Direct Serial ---');
    // We override the printerId to be 'serial:COM7'
    const res = await printVoucher(voucherData, 'serial:COM7');
    
    if (res.success) {
        console.log('✅ Serial COM7 SUCCESS');
    } else {
        console.error('❌ Serial COM7 FAILED:', res.error);
    }
}

run();
