
const { printVoucher } = require('./src/core/printer');

const voucherData = {
    username: 'TEST-COM11',
    password: 'PASSWORD',
    profile: '1 Hour',
    loginUrl: 'http://192.168.88.1'
};

async function run() {
    console.log('Testing COM11...');
    const res = await printVoucher(voucherData, 'serial:COM11');
    console.log('Result:', res);
}

run();
