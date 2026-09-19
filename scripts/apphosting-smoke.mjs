import { spawn } from 'node:child_process';

const port = 18080;
const child = spawn(process.execPath, ['scripts/apphosting-server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), GATEWAY_PORT: String(port), HOSTNAME: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

try {
  const deadline = Date.now() + 30000;
  let response;
  while (Date.now() < deadline) {
    try { response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!response?.ok) throw new Error(`health check failed\n${output}`);
  const health = await response.json();
  if (!health.ok || health.runtime !== 'apphosting') throw new Error(`unexpected health response: ${JSON.stringify(health)}`);
  const page = await fetch(`http://127.0.0.1:${port}/index.html`);
  if (!page.ok) throw new Error(`www/index.html returned ${page.status}`);
  console.log('[apphosting] health and www runtime checks passed');
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}
