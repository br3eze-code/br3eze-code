import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, test } from '@jest/globals';
import { Gateway } from '../../src/core/gateway-engine.js';
import { DiagnosticEventStore } from '../../src/core/diagnostics/diagnostic-store.js';
import { DiagnosticCaptureStore } from '../../src/core/diagnostics/diagnostic-capture-store.js';

describe('local gateway diagnostic ingestion', () => {
  let root;
  let gateway;
  let store;
  let captureStore;

  afterEach(async () => {
    await gateway?.stop();
    if (root) await fs.rm(root, { recursive: true, force: true });
    root = undefined;
    gateway = undefined;
    store = undefined;
    captureStore = undefined;
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
    expect(store.list()[0].page).toBe('/settings');
    expect(JSON.stringify(store.list())).not.toContain('private-secret');
  });

  test('instruments the built-in gateway dashboard when no PWA root exists', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-diagnostics-empty-'));
    store = new DiagnosticEventStore();
    gateway = new Gateway({ host: '127.0.0.1', port: 0, webRoot: root, web: { development: true }, diagnosticStore: store });
    const page = await request(gateway.getApp()).get('/').set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).toContain('__agentosDiagnosticsInstalled');
    const response = await request(gateway.getApp())
      .post('/__agentos/diagnostics/events')
      .set('Content-Type', 'application/json')
      .send({ source: 'browser.runtime', level: 'error', message: 'startup exception' });
    expect(response.status).toBe(202);
    expect(store.list()[0].message).toBe('startup exception');
  });

  test('rejects malformed events and disables ingestion outside development', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-diagnostics-'));
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>AgentOS</body></html>');
    store = new DiagnosticEventStore();
    gateway = new Gateway({ host: '127.0.0.1', port: 0, webRoot: root, web: { development: true }, diagnosticStore: store });

    const invalid = await request(gateway.getApp()).post('/__agentos/diagnostics/events').send({ source: 'browser.console' });
    expect(invalid.status).toBe(400);
  });

  test('does not inject or expose diagnostics in production mode', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-diagnostics-production-'));
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>Production page</body></html>');
    store = new DiagnosticEventStore();
    gateway = new Gateway({ host: '127.0.0.1', port: 0, webRoot: root, web: { development: false }, diagnosticStore: store });

    const page = await request(gateway.getApp()).get('/').set('Accept', 'text/html');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('__agentosDiagnosticsInstalled');
    const response = await request(gateway.getApp())
      .post('/__agentos/diagnostics/events')
      .set('Content-Type', 'application/json')
      .send({ source: 'browser.console', level: 'error', message: 'must not be stored' });
    expect(response.status).toBe(404);
    expect(store.list()).toHaveLength(0);
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
    const capture = await request(gateway.getApp()).post('/__agentos/diagnostics/captures')
      .set('Content-Type', 'application/json').send({ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(capture.status).toBe(404);
  });

  test('accepts user-approved capture on local development and serves a no-store preview', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-capture-'));
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>AgentOS</body></html>');
    store = new DiagnosticEventStore(); captureStore = new DiagnosticCaptureStore();
    gateway = new Gateway({ host:'127.0.0.1', port:0, webRoot:root, web:{development:true}, diagnosticStore:store, diagnosticCaptureStore:captureStore });
    const caps = await request(gateway.getApp()).get('/__agentos/diagnostics/capabilities');
    expect(caps.body).toMatchObject({screenCapture:true,browserNotifications:true,osNotifications:false});
    const saved = await request(gateway.getApp()).post('/__agentos/diagnostics/captures').set('Content-Type','application/json')
      .send({dataUrl:'data:image/png;base64,iVBORw0KGgo=',width:320,height:200});
    expect(saved.status).toBe(202);
    const meta = await request(gateway.getApp()).get('/__agentos/diagnostics/captures/latest/metadata');
    expect(meta.status).toBe(200); expect(meta.body.id).toBe(saved.body.id);
    expect(JSON.stringify(meta.body)).not.toContain('iVBORw0KGgo');
    const preview = await request(gateway.getApp()).get('/__agentos/diagnostics/captures/latest');
    expect(preview.status).toBe(200); expect(preview.headers['content-type']).toContain('image/png');
    expect(preview.headers['cache-control']).toBe('no-store'); expect(Buffer.isBuffer(preview.body)).toBe(true);
    expect(preview.body.toString('base64')).toBe('iVBORw0KGgo=');
  });

  test('rejects invalid and oversized captures before storage', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-capture-invalid-'));
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>AgentOS</body></html>');
    store = new DiagnosticEventStore(); captureStore = new DiagnosticCaptureStore({maxBytes:8});
    gateway = new Gateway({host:'127.0.0.1',port:0,webRoot:root,web:{development:true},diagnosticStore:store,diagnosticCaptureStore:captureStore});
    const invalid=await request(gateway.getApp()).post('/__agentos/diagnostics/captures').set('Content-Type','application/json').send({dataUrl:'data:text/html;base64,PHNjcmlwdD4='});
    expect(invalid.status).toBe(400);
    const large=await request(gateway.getApp()).post('/__agentos/diagnostics/captures').set('Content-Type','application/json').send({dataUrl:'data:image/png;base64,iVBORw0KGgoAAAAA',width:320,height:200});
    expect(large.status).toBe(413); expect(captureStore.size).toBe(0);
  });

  test('does not expose capture routes in production', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-capture-prod-'));
    await fs.writeFile(path.join(root, 'index.html'), '<html><body>Production</body></html>');
    store = new DiagnosticEventStore(); captureStore = new DiagnosticCaptureStore();
    gateway = new Gateway({host:'127.0.0.1',port:0,webRoot:root,web:{development:false},diagnosticStore:store,diagnosticCaptureStore:captureStore});
    const response=await request(gateway.getApp()).post('/__agentos/diagnostics/captures').set('Content-Type','application/json').send({dataUrl:'data:image/png;base64,iVBORw0KGgo='});
    expect(response.status).toBe(404); expect(captureStore.size).toBe(0);
  });

});
