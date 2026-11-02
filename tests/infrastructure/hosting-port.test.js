import test from 'node:test';
import assert from 'node:assert/strict';
import { assertHostingProvider, registerHostingProvider, getHostingProvider, requireHostingProvider, clearHostingProvider } from '../../src/core/ports/hosting.js';

const base = () => ({ id: 'test-host', capabilities: ['runtime-info', 'health'], getRuntimeInfo: async () => ({ runtime: 'node', version: process.version }), healthCheck: async () => ({ status: 'ok' }) });

test('registers a provider-neutral hosting adapter', async () => {
  clearHostingProvider();
  const provider = base();
  assert.equal(registerHostingProvider(provider), provider);
  assert.equal(getHostingProvider(), provider);
  assert.equal((await requireHostingProvider().healthCheck()).status, 'ok');
  clearHostingProvider();
});

test('rejects unknown capabilities and missing declared methods', () => {
  assert.throws(() => assertHostingProvider({ ...base(), capabilities: ['aws-eks'] }), /Unsupported hosting capability/);
  assert.throws(() => assertHostingProvider({ ...base(), capabilities: ['deploy'] }), /does not implement deploy/);
});

test('requires stable identity and mandatory runtime health contract', () => {
  assert.throws(() => assertHostingProvider({ ...base(), id: 'AWS/EKS' }), /provider id/);
  assert.throws(() => assertHostingProvider({ id: 'test-host', capabilities: ['runtime-info'], getRuntimeInfo() {} }), /healthCheck/);
});

test('provider registry is isolated and clearable', () => {
  clearHostingProvider();
  assert.equal(getHostingProvider(), null);
  assert.throws(() => requireHostingProvider(), /No hosting provider registered/);
});
