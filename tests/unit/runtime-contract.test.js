import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  AGENT_RUNTIME_CONTRACT_VERSION,
  createRuntimeRequest,
} from '../../src/core/runtime-contract.js';

test('runtime request includes stable core fields and freezes contract containers', () => {
  const context = { source: 'cli' };
  const capabilities = ['agent.run'];
  const request = createRuntimeRequest({ sessionId: ' session-1 ', input: 'run', context, capabilities });

  assert.equal(request.contractVersion, AGENT_RUNTIME_CONTRACT_VERSION);
  assert.equal(request.sessionId, 'session-1');
  assert.equal(request.input, 'run');
  assert.deepEqual(request.context, { source: 'cli' });
  assert.deepEqual(request.capabilities, ['agent.run']);
  assert.deepEqual(request.metadata, {});
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.context), true);
  assert.equal(Object.isFrozen(request.capabilities), true);
  assert.equal(Object.isFrozen(request.metadata), true);

  context.source = 'changed';
  capabilities.push('system.reboot');
  assert.equal(request.context.source, 'cli');
  assert.deepEqual(request.capabilities, ['agent.run']);
});

test('runtime request carries optional host-neutral execution metadata', () => {
  const request = createRuntimeRequest({
    sessionId: 's1',
    input: { action: 'run' },
    requestId: 'req-1',
    tenantId: 'tenant-1',
    identity: 'user-1',
    idempotencyKey: 'idem-1',
    approvalRef: 'approval-1',
    traceId: 'trace-1',
  });

  assert.deepEqual(request.metadata, {
    requestId: 'req-1',
    tenantId: 'tenant-1',
    identity: 'user-1',
    idempotencyKey: 'idem-1',
    approvalRef: 'approval-1',
    traceId: 'trace-1',
  });
});

test('runtime request rejects malformed required fields and capabilities', () => {
  assert.throws(() => createRuntimeRequest({ input: 'run' }), /sessionId is required/);
  assert.throws(() => createRuntimeRequest({ sessionId: 's1' }), /input is required/);
  assert.throws(() => createRuntimeRequest({ sessionId: 's1', input: 'run', context: [] }), /context must be an object/);
  assert.throws(() => createRuntimeRequest({ sessionId: 's1', input: 'run', capabilities: [''] }), /capabilities must be an array/);
  assert.throws(() => createRuntimeRequest({ sessionId: 's1', input: 'run', tenantId: '   ' }), /tenantId must be a non-empty string/);
});
