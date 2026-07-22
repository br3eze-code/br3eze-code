const { getManager } = require('./src/core/mikrotik');
const dotenv = require('dotenv');
const path = require('path');

// Load .env
dotenv.config();

async function test() {
    console.log('--- MikroTik Connection Diagnostic ---');
    console.log('IP:', process.env.MIKROTIK_IP);
    console.log('User:', process.env.MIKROTIK_USER);
    console.log('Pass:', process.env.MIKROTIK_PASS ? '********' : '(empty)');
    console.log('Port:', process.env.MIKROTIK_PORT || 8728);

    const manager = getManager({
        host: process.env.MIKROTIK_IP,
        user: process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASS,
        port: parseInt(process.env.MIKROTIK_PORT) || 8728
    });

    manager.on('connected', () => {
        console.log('✅ CONNECTED SUCCESS');
        process.exit(0);
    });

    manager.on('connectionFailed', (err) => {
        console.error('❌ CONNECTION FAILED:', err.message);
        console.error('Stack:', err.stack);
        process.exit(1);
    });

    try {
        console.log('Connecting...');
        await manager.connect();
    } catch (err) {
        console.error('❌ CATCH ERROR:', err.message);
        process.exit(1);
    }
}

test();
