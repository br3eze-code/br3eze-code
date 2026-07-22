require('dotenv').config();
const { MikroTikManager } = require('../src/core/mikrotik');

async function applySetup() {
    const mt = new MikroTikManager();

    try {
        console.log('Connecting to MikroTik...');
        await mt.connect();
        
        console.log('Applying hotspot user profiles...');

        const profiles = [
            { name: '1Hour', 'shared-users': '1', 'rate-limit': '10M/10M', 'session-timeout': '1h' },
            { name: '1Day', 'shared-users': '1', 'rate-limit': '25M/25M', 'session-timeout': '24h' },
            { name: '7Day', 'shared-users': '1', 'rate-limit': '50M/50M', 'session-timeout': '7d' },
            { name: '30Day', 'shared-users': '1', 'rate-limit': '50M/50M', 'session-timeout': '30d' },
            { name: 'trial', 'shared-users': '1', 'rate-limit': '2M/2M', 'session-timeout': '15m' }
        ];

        const existingProfiles = await mt.executeTool('profile.list');

        for (const p of profiles) {
            const result = await mt.updateHotspotProfile({
                name: p.name,
                sharedUsers: parseInt(p['shared-users']),
                rateLimit: p['rate-limit'],
                sessionTimeout: p['session-timeout']
            });
            console.log(`${result.status === 'created' ? 'Added' : 'Updated'} ${p.name}...`);
        }
        
        console.log('\n[PASS] Profiles applied successfully.');

    } catch (err) {
        console.error('[ERROR]', err.message);
        process.exitCode = 1;
    } finally {
        console.log('Disconnecting...');
        await mt.disconnect();
    }
}

applySetup();
