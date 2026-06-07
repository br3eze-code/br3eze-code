
const { printVoucher } = require('./src/core/printer');

const voucherData = {
    username: 'TEST-POS-58',
    password: 'PASSWORD',
    profile: '1 Hour',
    loginUrl: 'http://192.168.88.1'
};

async function run() {
    console.log('Testing POS-58...');
    const res = await printVoucher(voucherData, 'printer:POS-58');
    console.log('Result:', res);
}

run();
