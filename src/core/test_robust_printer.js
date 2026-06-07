
const { printVoucher } = require('./printer');
const { logger } = require('./logger');

const voucherData = {
    username: 'TEST-USER',
    password: 'TEST-PASSWORD',
    profile: '1H-Unlimited',
    duration: '1 hour',
    expires: new Date(Date.now() + 3600000).toISOString(),
    price: 5.00,
    currency: '$',
    loginUrl: 'http://192.168.88.1/login'
};

console.log('Testing robust Windows printing via PowerShell...');
printVoucher(voucherData).then(res => {
    if (res.success) {
        console.log('✅ TEST SUCCESSFUL');
    } else {
        console.error('❌ TEST FAILED:', res.error);
        if (res.stack) console.error(res.stack);
    }
    process.exit(res.success ? 0 : 1);
}).catch(err => {
    console.error('💥 CRASHED:', err);
    process.exit(1);
});
