const HandlerLibrary = require('../src/core/channels/HandlerLibrary');

// Mock Channel
const mockChannel = {
  send: async (jid, text) => {
    console.log(`[SEND TO ${jid}] ${text}`);
    return { success: true };
  }
};

// Mock Global State
global.AGENTOS = { BRAND: { name: 'TestOS' } };
global.mikrotik = {
  state: { isConnected: true },
  getSystemResources: async () => [{ cpu: '10%', uptime: '1h', version: '7.12', 'board-name': 'hAP ax2' }],
  getInterfaces: async () => [{ name: 'ether1', type: 'ether', running: 'true' }],
  getDhcpLeases: async () => [{ address: '192.168.88.10', 'host-name': 'Phone' }]
};

async function runTests() {
  console.log('--- Testing Dashboard ---');
  await HandlerLibrary.handleDashboard(mockChannel, 'user123');

  console.log('\n--- Testing Stats ---');
  await HandlerLibrary.handleStats(mockChannel, 'user123');

  console.log('\n--- Testing Network ---');
  await HandlerLibrary.handleNetwork(mockChannel, 'user123');

  console.log('\n--- Testing Ping ---');
  await HandlerLibrary.handlePing(mockChannel, 'user123');
}

runTests().catch(console.error);
