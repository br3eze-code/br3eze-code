const registry = require('../src/core/ToolRegistry');
const loadAllDomains = require('../src/core/loadDomain');
const path = require('path');

async function testAIStatus() {
  console.log('Testing ai.status tool...');
  
  // Initialize registry
  const domainsDir = path.join(__dirname, '..', 'src', 'domains');
  
  // Load domains
  await loadAllDomains(domainsDir, registry);
  
  // Execute ai.status
  try {
    const result = await registry.execute('ai.status');
    console.log('AI Status Result:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error executing ai.status:', error.message);
  }
}

testAIStatus();
