
const ObsidianAdapter = require('../src/core/memory/adapters/ObsidianAdapter');
const path = require('path');
const fs = require('fs/promises');

async function test() {
    // Mock config
    process.env.STATE_PATH = path.join(__dirname, 'test_state');

    const adapter = new ObsidianAdapter();
    adapter.vaultPath = path.join(__dirname, 'test_vault');

    console.log('--- Initializing ---');
    await adapter.initialize();

    console.log('--- Setting deep key ---');
    await adapter.set('user:123:profile', { name: 'Test User', age: 30 });

    console.log('--- Getting deep key ---');
    const val = await adapter.get('user:123:profile');
    console.log('Value:', val);

    console.log('--- Checking file structure ---');
    const exists = await fs.stat(path.join(adapter.vaultPath, 'user', '123', 'profile.md')).catch(() => null);
    console.log('Hierarchical file exists:', !!exists);

    console.log('--- Testing list ---');
    const keys = await adapter.list('user');
    console.log('Keys under "user":', keys);

    console.log('--- Testing push/trim ---');
    await adapter.set('user:123:history', []);
    await adapter.push('user:123:history', { msg: 'hello' });
    await adapter.push('user:123:history', { msg: 'world' });
    const history = await adapter.get('user:123:history');
    console.log('History:', history);

    console.log('--- Cleaning up ---');
    await fs.rm(adapter.vaultPath, { recursive: true, force: true });
    await fs.rm(process.env.STATE_PATH, { recursive: true, force: true });
}

test().catch(console.error);
