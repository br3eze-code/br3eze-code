import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, test } from '@jest/globals';
import { Gateway } from '../../src/core/gateway-engine.js';
import { DiagnosticEventStore } from '../../src/core/diagnostics/diagnostic-store.js';

describe('local gateway diagnostic ingestion', () => {
  let root;
  let gateway;
  let store;

  afterEach(async () => {
    await gateway?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  test('injects browser observer and stores only redacted error metadata', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-diagnostics-'));
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><body>AgentOS</body></html>');
    store = new DiagnosticEventStore({ maxEvents: 10 });
    gateway = new Gateway({ host: '127.0.0.1', port: 0, webRoot: root, web: { development: true }, diagnosticStore: store });

    const page = await request(gateway.getApp()).get('/').set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('__agentosDiagnosticsInstalled');
    expect(page.text).toContain('/__agentos/diagnostics/events');

    const accepted = await request(gateway.getApp())
      .post('/__agentos/diagnostics/events')
      .set('Content-Type', 'application/json')
      .send({ source: 'browser.console', level: 'error', message: 'token=private-secret ReferenceError', page: '/settings?token=private-secret' });
    expect(accepted.status).toBe(202);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].message).toContain('[REDACTED]');
    expect(JSON.stringify(store.list())).not.toContain('private-secret');
  });

  test('rejects malformed events and disables ingestion outside development', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-diagnostics-'));
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>AgentOS</body></html>');
    store = new DiagnosticEventStore();
    gateway = new Gateway({ host: '127.0.0.1', port: 0, webRoot: root, web: { development: true }, diagnosticStore: store });

    const invalid = await request(gateway.getApp()).post('/__agentos/diagnostics/events').send({ source: 'browser.console' });
    expect(invalid.status).toBe(400);
  });

  test('does not expose diagnostic ingestion when the gateway listener is non-loopback', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-diagnostics-'));
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>AgentOS</body></html>');
    store = new DiagnosticEventStore();
    gateway = new Gateway({ host: '0.0.0.0', port: 0, webRoot: root, web: { development: true }, diagnosticStore: store });

    const response = await request(gateway.getApp())
      .post('/__agentos/diagnostics/events')
      .set('Content-Type', 'application/json')
      .send({ source: 'browser.console', level: 'error', message: 'should not be collected' });
    expect(response.status).toBe(404);
    expect(store.list()).toHaveLength(0);
  });
});
