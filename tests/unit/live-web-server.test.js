import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { Gateway } from '../../src/core/gateway-engine.js';

describe('Gateway live web serving', () => {
  let root;
  let gateway;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-web-'));
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><body><main>AgentOS console</main></body></html>');
    await fs.mkdir(path.join(root, 'assets'));
    await fs.writeFile(path.join(root, 'assets', 'app.js'), 'window.agentosReady = true;');
    gateway = new Gateway({ host: '127.0.0.1', port: 0, webRoot: root, web: { development: true } });
  });

  afterEach(async () => {
    await gateway?.stop();
    await fs.rm(root, { recursive: true, force: true });
  });

  test('serves the configured PWA at the root and injects development live reload', async () => {
    const response = await request(gateway.getApp()).get('/').set('Accept', 'text/html');
    expect(response.status).toBe(200);
    expect(response.text).toContain('AgentOS console');
    expect(response.text).toContain("EventSource('/__agentos/live')");
    expect(response.headers['cache-control']).toContain('no-store');
  });

  test('uses SPA fallback for extensionless frontend routes', async () => {
    const response = await request(gateway.getApp()).get('/settings/profile').set('Accept', 'text/html');
    expect(response.status).toBe(200);
    expect(response.text).toContain('AgentOS console');
  });

  test('serves static assets without routing them through the SPA fallback', async () => {
    const response = await request(gateway.getApp()).get('/assets/app.js');
    expect(response.status).toBe(200);
    expect(response.text).toContain('agentosReady');
  });

  test('does not let unknown API routes fall back to the frontend', async () => {
    const response = await request(gateway.getApp()).get('/api/not-registered').set('Accept', 'text/html');
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('API route not found');
  });

  test('keeps the built-in gateway dashboard when no AgentOS web root exists', async () => {
    const emptyRoot = path.join(root, 'empty');
    await fs.mkdir(emptyRoot);
    const emptyGateway = new Gateway({ host: '127.0.0.1', port: 0, webRoot: emptyRoot });
    const response = await request(emptyGateway.getApp()).get('/').set('Accept', 'text/html');
    expect(response.status).toBe(200);
    expect(response.text).toContain('AgentOS Gateway');
    await emptyGateway.stop();
  });
});
