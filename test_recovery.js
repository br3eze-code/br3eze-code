const { getDatabase } = require('./src/core/database');
const { createManager } = require('./src/core/mikrotik');
const dotenv = require('dotenv');

// Load the newly restored .env
dotenv.config();

async function testRecovery() {
    console.log('--- Testing System Recovery ---');
    
    // 1. Test Firebase
    console.log('\n[1/2] Testing Firebase Reconnection...');
    const db = await getDatabase();
    try {
        // Database constructor starts initialization
        // We wait a bit for the connection loop or check
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        if (db.db) {
            console.log('✅ SUCCESS: Firebase Connected');
            const snap = await db.db.collection('system_config').limit(1).get();
            console.log(`Verified: Found ${snap.size} config docs`);
        } else {
            console.log('❌ FAILED: Firebase still disconnected (falling back to SQLite)');
        }
    } catch (err) {
        console.error(`❌ ERROR: Firebase check failed: ${err.message}`);
    }

    // 2. Test MikroTik
    console.log('\n[2/2] Testing MikroTik Reconnection (192.168.88.1)...');
    const manager = createManager({
        host: process.env.MIKROTIK_IP,
        user: process.env.MIKROTIK_USER,
        password: process.env.MIKROTIK_PASS
    });

    try {
        const connected = await manager.connect();
        if (connected) {
            console.log('✅ SUCCESS: MikroTik Connected');
            await manager.disconnect();
        } else {
            console.log('❌ FAILED: MikroTik unreachable (likely network routing issue)');
        }
    } catch (err) {
        console.error(`❌ ERROR: MikroTik connection failed: ${err.message}`);
    }
}

testRecovery();
