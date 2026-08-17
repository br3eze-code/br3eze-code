import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FleetHealthPoller } from '../core/fleet-health-poller.js';

const env = process.env;
const required = (name) => {
  const value = env[name];
  if (!value || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
};
const integer = (name, fallback, minimum = 1) => {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
};

const enabled = env.FLEET_WORKER_ENABLED !== 'false';
const healthHost = env.FLEET_WORKER_HEALTH_HOST || '0.0.0.0';
const healthPort = integer('FLEET_WORKER_HEALTH_PORT', 9090);
const intervalMs = integer('FLEET_POLL_INTERVAL_MS', 30000, 1000);
const maxConcurrency = integer('FLEET_POLL_MAX_CONCURRENCY', 25);
const timeoutMs = integer('FLEET_POLL_TIMEOUT_MS', 10000, 100);
const leaseMs = integer('FLEET_POLL_LEASE_MS', 30000, 1000);
const alertCooldownMs = integer('FLEET_ALERT_COOLDOWN_MS', 300000, 0);
const tenantIds = (env.FLEET_TENANT_IDS || '').split(',').map((value) => value.trim()).filter(Boolean);
const principalId = env.FLEET_WORKER_PRINCIPAL_ID || 'fleet-worker';

let state = { status: enabled ? 'starting' : 'disabled', lastPollAt: null, lastError: null, lastResults: null };
let provider;
let poller;
let timer;
let healthServer;
let stopping = false;

async function loadProvider() {
  const modulePath = required('FLEET_WORKER_PROVIDER_MODULE');
  const absolutePath = path.isAbsolute(modulePath) ? modulePath : path.resolve(process.cwd(), modulePath);
  const loaded = await import(pathToFileURL(absolutePath).href);
  provider = loaded.default || loaded;
  if (typeof provider.listTargets !== 'function' || typeof provider.pollTarget !== 'function') {
    throw new TypeError('FLEET_WORKER_PROVIDER_MODULE must export listTargets and pollTarget functions');
  }
  return provider;
}

async function pollOnce() {
  if (stopping || !poller) return;
  const selectedTenants = tenantIds.length ? tenantIds : [null];
  const results = [];
  for (const tenantId of selectedTenants) {
    if (!tenantId) continue;
    results.push(await poller.poll({ tenantId, principalId, context: { source: 'fleet-worker' } }));
  }
  state = { status: 'ready', lastPollAt: new Date().toISOString(), lastError: null, lastResults: results };
}

function startHealthServer() {
  healthServer = http.createServer((request, response) => {
    if (request.url !== '/healthz' && request.url !== '/readyz') {
      response.writeHead(404); response.end(); return;
    }
    const ready = state.status === 'ready' || (state.status === 'disabled' && !enabled);
    const payload = { ...state, enabled, tenantCount: tenantIds.length, uptime: process.uptime() };
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  healthServer.listen(healthPort, healthHost);
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  state = { ...state, status: 'stopping' };
  if (timer) clearInterval(timer);
  await provider?.close?.().catch(() => {});
  await new Promise((resolve) => healthServer?.close(resolve) || resolve());
  process.exit(signal === 'uncaughtException' ? 1 : 0);
}

async function main() {
  startHealthServer();
  if (!enabled) return;
  if (tenantIds.length === 0) throw new Error('FLEET_TENANT_IDS must contain at least one tenant ID');
  const loaded = await loadProvider();
  poller = new FleetHealthPoller({
    listTargets: loaded.listTargets,
    pollTarget: loaded.pollTarget,
    snapshotStore: loaded.saveSnapshot,
    notificationHub: loaded.notificationHub,
    maxConcurrency,
    timeoutMs,
    leaseMs,
    alertCooldownMs,
  });
  await pollOnce();
  timer = setInterval(() => pollOnce().catch((error) => {
    state = { ...state, status: 'degraded', lastError: { code: error.code || 'FLEET_WORKER_ERROR', message: error.message } };
  }), intervalMs);
  timer.unref?.();
}

for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => shutdown(signal));
process.once('uncaughtException', (error) => { state = { ...state, status: 'failed', lastError: { message: error.message } }; shutdown('uncaughtException'); });
process.once('unhandledRejection', (error) => { state = { ...state, status: 'failed', lastError: { message: error?.message || String(error) } }; shutdown('unhandledRejection'); });

main().catch((error) => {
  state = { ...state, status: 'failed', lastError: { code: error.code || 'FLEET_WORKER_START_FAILED', message: error.message } };
  console.error(`[fleet-worker] ${error.stack || error.message}`);
  shutdown('startup-failure');
});

export { main as startFleetHealthWorker };
export default { startFleetHealthWorker: main };

void required;
void pathToFileURL;
void http;
void enabled;
void healthHost;
void healthPort;
void intervalMs;
void maxConcurrency;
void timeoutMs;
void leaseMs;
void alertCooldownMs;
void tenantIds;
void principalId;
