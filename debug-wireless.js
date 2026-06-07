const { RouterOSClient } = require('routeros-client');
require('dotenv').config();

const CONFIG = {
    IP: process.env.MIKROTIK_IP || '192.168.88.1',
    USER: process.env.MIKROTIK_USER || 'admin',
    PASS: process.env.MIKROTIK_PASS,
    PORT: parseInt(process.env.MIKROTIK_PORT) || 8728
};

async function test() {
    console.log(`Connecting to ${CONFIG.IP}...`);
    const api = new RouterOSClient({ 
        host: CONFIG.IP, 
        user: CONFIG.USER, 
        password: CONFIG.PASS, 
        port: CONFIG.PORT, 
        timeout: 5000 
    });

    try {
        const conn = await api.connect();
        console.log('Connected!');
        
        console.log('Checking wireless interfaces...');
        const ifaces = await conn.menu('/interface/wireless').get();
        console.table(ifaces.map(i => ({
            name: i.name,
            ssid: i.ssid,
            band: i.band,
            frequency: i.frequency,
            running: i.running,
            disabled: i.disabled
        })));

        api.close();
    } catch (err) {
        console.error('Connection failed:', err.message);
    }
}

test();
