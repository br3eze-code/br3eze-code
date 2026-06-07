const { getManager } = require('../src/core/mikrotik');
const { logger } = require('../src/core/logger');

async function debug() {
    const mikrotik = getManager();
    console.log('Connecting to MikroTik...');
    await mikrotik.connect();

    console.log('\n--- Testing system.stats ---');
    try {
        const stats = await mikrotik.executeTool('system.stats');
        console.log('Stats:', JSON.stringify(stats, null, 2));
    } catch (e) {
        console.error('system.stats failed:', e.message);
    }

    console.log('\n--- Testing users.active ---');
    try {
        const users = await mikrotik.executeTool('users.active');
        console.log('Active Users:', JSON.stringify(users, null, 2));
    } catch (e) {
        console.error('users.active failed:', e.message);
    }

    console.log('\n--- Testing bandwidth (new tool) ---');
    try {
        // Test with localhost if possible, or just check if it tries to run
        const bw = await mikrotik.executeTool('bandwidth', { target: '127.0.0.1', duration: 1 });
        console.log('Bandwidth Result:', JSON.stringify(bw, null, 2));
    } catch (e) {
        console.error('bandwidth failed:', e.message);
    }

    mikrotik.disconnect();
}

debug();
