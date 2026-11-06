import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

test('local server serves homepage, HTML assets, API health, and safe API 404s', { timeout: 45000 }, async t => {
  const port = await unusedPort();
  const child = spawn(process.execPath, ['scripts/serve.mjs', '--mode=dev'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', DATA_BACKEND: 'local', HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000).unref();
    });
  });

  const base = `http://127.0.0.1:${port}`;
  let health;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) assert.fail(`server exited before becoming ready:\n${output}`);
    try {
      health = await fetch(`${base}/_serve/health`);
      if (health.ok) break;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(health?.ok, `server did not become ready:\n${output}`);
  assert.equal((await health.json()).mode, 'development');

  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Prepaid WiFi that keeps working/i);

  const explicitHome = await fetch(`${base}/home.html`);
  assert.equal(explicitHome.status, 200);
  assert.match(await explicitHome.text(), /Prepaid WiFi/i);

  const connect = await fetch(`${base}/connect.html`);
  assert.equal(connect.status, 200);
  assert.match(await connect.text(), /Power Connect/i);

  const apiHealth = await fetch(`${base}/api/health`);
  assert.equal(apiHealth.status, 200);
  assert.equal((await apiHealth.json()).ok, true);

  const missingApi = await fetch(`${base}/api/not-a-real-endpoint`);
  assert.equal(missingApi.status, 404);
  assert.equal((await missingApi.json()).error, 'not_found');
});
