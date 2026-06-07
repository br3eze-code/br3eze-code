const { getManager } = require('../src/core/mikrotik');
const { logger } = require('../src/core/logger');

async function testEnforcement() {
    const mt = getManager();
    console.log('--- MikroTik Enforcement Test ---');
    
    try {
        console.log('1. Connecting...');
        const connected = await mt.connect();
        if (!connected) {
            console.error('Failed to connect to MikroTik');
            process.exit(1);
        }

        const testUser = 'user5'; 
        let current = mt.state.conn;
        console.log('--- Property Search for "write" ---');
        while (current) {
            const keys = Object.getOwnPropertyNames(current);
            if (keys.includes('write')) {
                console.log(`Found "write" in object:`, current.constructor.name);
                break;
            }
            current = Object.getPrototypeOf(current);
        }
        console.log('--- End Property Search ---');

        if (mt.state.conn.rosApi) {
            console.log(`2. Testing rosApi keys:`, Object.getOwnPropertyNames(mt.state.conn.rosApi));
        }
        console.log(`2. Testing disable for user: ${testUser}`);
        const menu = mt.state.conn.menu('/ip/hotspot/user');
        const users = await menu.where('name', testUser).get();
        if (users.length > 0) {
            const id = mt._getId(users[0]);
            console.log(`Found user with ID: ${id}`);
            try {
                console.log('Trying executeRawAPI for disable...');
                const res = await mt.executeRawAPI(['/ip/hotspot/user/set', '=.id=' + id, '=disabled=yes']);
                console.log('Direct Disable Result:', res);
            } catch (e) {
                console.error('Direct Disable Failed:', e.message);
            }
        } else {
            console.log('User not found');
        }

        console.log(`3. Testing enable for user: ${testUser}`);
        if (users.length > 0) {
            const id = mt._getId(users[0]);
            try {
                console.log('Trying executeRawAPI for enable...');
                const res = await mt.executeRawAPI(['/ip/hotspot/user/set', '=.id=' + id, '=disabled=no']);
                console.log('Direct Enable Result:', res);
            } catch (e) {
                console.error('Direct Enable Failed:', e.message);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error('TEST FAILED:', err);
        process.exit(1);
    }
}

testEnforcement();
