
const { printVoucher } = require('./src/core/printer');

const voucherData = {
    username: 'TEST-COM12',
    password: 'PASSWORD',
    profile: '1 Hour',
    loginUrl: 'http://192.168.88.1'
};

async function run() {
    console.log('Testing COM12...');
    const res = await printVoucher(voucherData, 'serial:COM12');
    console.log('Result:', res);
}

run();
