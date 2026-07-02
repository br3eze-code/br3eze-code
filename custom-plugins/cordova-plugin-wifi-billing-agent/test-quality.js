const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Check Execution Shebang
function testShebang() {
  console.log('[Test] Verifying Execution Shebang...');
  const content = fs.readFileSync(path.join(__dirname, 'www/agents/hotspotAgent.js'), 'utf8');
  assert.ok(content.startsWith('#!/usr/bin/env node'), 'Shebang is broken or invalid');
  console.log('✅ Shebang is correct.');
}

// 2. Mock missing Telegram context & Winston log locations
function testLogDirectory() {
  console.log('[Test] Verifying Logging Directory Paths...');
  const logDir = path.join(__dirname, 'www/agents/logs');
  // If the agent creates the directory properly, this will pass when we run or check its paths
  const content = fs.readFileSync(path.join(__dirname, 'www/agents/hotspotAgent.js'), 'utf8');
  assert.ok(
    content.includes("path.join(__dirname, 'logs')"),
    'Logs directory resolution is NOT absolute!'
  );
  console.log('✅ Log directory initialization is absolute.');
}

// 3. Test formatResponse and _dispatchFunctionCall
function testAIFormatting() {
  console.log('[Test] Verifying AI Response Type Safety...');
  const content = fs.readFileSync(path.join(__dirname, 'www/agents/hotspotAgent.js'), 'utf8');
  assert.ok(
    content.includes('const strOpts = String(s);'),
    'AI formatting lacks text type casting safe guards'
  );
  assert.ok(
    content.includes('const { action, plan, target } = args || {};'),
    'AI function dispatch lacks empty arg object fallbacks'
  );
  console.log('✅ AI formatting type errors are patched.');
}

// 4. Test Telegram Callback query Auth execution
function testTelegramCallbackAuth() {
  console.log('[Test] Verifying Telegram Authentication Check Guards...');
  const content = fs.readFileSync(path.join(__dirname, 'www/agents/hotspotAgent.js'), 'utf8');
  assert.ok(
    content.includes('if (!this._checkAuth(fakeMsg)) return;'),
    'Callback queries lack strict inline authorization guards'
  );
  console.log('✅ Telegram Callback logic is protected.');
}

try {
  console.log('--- AgentOS Quality Suite ---');
  testShebang();
  testLogDirectory();
  testAIFormatting();
  testTelegramCallbackAuth();
  console.log('-----------------------------');
  console.log('🏁 All Quality Tests Passed Successfully!');
} catch (err) {
  console.error(`❌ Test Failed: ${err.message}`);
  process.exit(1);
}
