const registry = require('../src/core/ToolRegistry');
const loadAllDomains = require('../src/core/loadDomain');
const path = require('path');

async function testAIVerify() {
  console.log('Testing ai.verify tool...');
  
  const domainsDir = path.join(__dirname, '..', 'src', 'domains');
  await loadAllDomains(domainsDir, registry);
  
  try {
    const result = await registry.execute('ai.verify', ['anthropic']);
    console.log('AI Verify Result (Anthropic):');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error executing ai.verify:', error.message);
  }
}

testAIVerify();
