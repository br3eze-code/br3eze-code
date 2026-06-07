const { createManager } = require('./src/core/mikrotik');
const dotenv = require('dotenv');

// Load .env
dotenv.config();

async function testConnection(host, user, password) {
    console.log(`\n--- Testing Connection to ${host} ---`);
    console.log(`User: ${user}`);

    const manager = createManager({
        host: host,
        user: user,
        password: password,
        port: 8728,
        timeout: 5000
    });

    try {
        const connected = await manager.connect();
        if (connected) {
            console.log(`✅ SUCCESS: Connected to ${host}`);

            // Try to get system identity
            try {
                const identity = await manager.executeTool('system.identity');
                console.log(`Identity:`, identity);
            } catch (e) {
                console.log(`Could not get identity: ${e.message}`);
            }

            await manager.disconnect();
            return true;
        } else {
            console.log(`❌ FAILED: Could not connect to ${host}`);
            return false;
        }
    } catch (err) {
        console.error(`❌ ERROR: ${err.message}`);
        return false;
    }
}

async function run() {
    const routers = [
        { host: '192.168.88.1', user: 'admin', pass: 'admin123!' },
        { host: '192.168.1.1', user: 'admin', pass: 'admin123!' },
        { host: '192.168.88.1', user: 'admin', pass: '' },
        { host: '192.168.1.1', user: 'admin', pass: '' }
    ];

    for (const r of routers) {
        await testConnection(r.host, r.user, r.pass);
    }
}

run();
