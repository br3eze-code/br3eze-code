require('dotenv').config();
const { MikroTikManager } = require('../src/core/mikrotik');

async function verifyProfiles() {
    const mt = new MikroTikManager();

    try {
        console.log('Connecting to MikroTik...');
        await mt.connect();
        
        console.log('Checking Hotspot User Profiles...');
        const userProfiles = await mt.executeTool('profile.list');
        console.log(userProfiles.map(p => `- ${p.name}: ${p['rate-limit'] || 'unlimited'} / session-timeout: ${p['session-timeout'] || 'unlimited'} / shared-users: ${p['shared-users'] || '1'}`));

        // Compare against expected setup.rsc values
        const expected = ['1Hour', '1Day', '7Day', '30Day', 'trial'];
        const missing = expected.filter(e => !userProfiles.some(p => p.name === e));
        
        if (missing.length > 0) {
            console.error('\n[FAIL] Missing profiles:', missing);
            process.exitCode = 1;
        } else {
            console.log('\n[PASS] All expected user profiles are present.');
        }

    } catch (err) {
        console.error('[ERROR]', err.message);
        process.exitCode = 1;
    } finally {
        console.log('Disconnecting...');
        await mt.disconnect();
    }
}

verifyProfiles();
