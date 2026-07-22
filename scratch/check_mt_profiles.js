'use strict';
const { MikroTikManager } = require('../src/core/mikrotik');
const { logger } = require('../src/core/logger');

async function check() {
    const mt = new MikroTikManager();
    try {
        await mt.connect();
        const profiles = await mt.getHotspotProfiles();
        console.log('--- MikroTik Hotspot Profiles ---');
        console.log(JSON.stringify(profiles, null, 2));
    } catch (e) {
        console.error('Failed to connect to MikroTik:', e.message);
    } finally {
        mt.disconnect();
    }
}

check().catch(console.error);
