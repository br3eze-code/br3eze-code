
const { getConfig } = require('../src/core/config');
const { MikroTikManager } = require('../src/core/mikrotik');

async function test() {
    const config = getConfig().mikrotik;
    const manager = new MikroTikManager(config);
    console.log('Connecting...');
    await manager.connect();
    console.log('Connected.');
    
    console.log('inspecting this.state.conn keys:', Object.keys(manager.state.conn));
    console.log('type of this.state.conn.write:', typeof manager.state.conn.write);
    console.log('has rosApi:', !!manager.state.conn.rosApi);
    
    manager.destroy();
}

test().catch(console.error);
