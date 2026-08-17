import { describe, expect, test } from '@jest/globals';
import { validate, register, has, list, isCompatible } from '../src/core/contracts/contract-registry.js';

describe('versioned contract registry', () => {
  test('validates core work and evidence envelopes', () => {
    expect(validate('agentos.work.v1', {
      id: 'work-1',
      tenantId: 'tenant-1',
      status: 'READY',
    }).contract).toBe('agentos.work.v1');

    expect(validate('agentos.evidence.v1', {
      id: 'evidence-1',
      actionId: 'action-1',
      kind: 'health.snapshot',
      createdAt: new Date().toISOString(),
    }).contract).toBe('agentos.evidence.v1');
  });

  test('requires complete adapter manifests', () => {
    expect(() => validate('agentos.adapter.v1', {
      id: 'network.adapter',
      version: '1.0.0',
      capabilities: ['health.read'],
      operations: ['poll'],
      health: { state: 'healthy' },
    })).not.toThrow();

    expect(() => validate('agentos.adapter.v1', {
      id: 'network.adapter',
      version: '1.0.0',
      capabilities: ['health.read'],
      operations: ['poll'],
    })).toThrow(/health/);
  });

  test('supports extension registration and forward compatibility', () => {
    register('agentos.test.v1', { required: ['id', 'tenantId'] });
    expect(has('agentos.test.v1')).toBe(true);
    expect(validate('agentos.test.v1', { id: 'test-1', tenantId: 'tenant-1' }).contract)
      .toBe('agentos.test.v1');
    expect(isCompatible('agentos.test.v1', 'agentos.test.v1')).toBe(true);
    expect(isCompatible('agentos.test.v2', 'agentos.test.v1')).toBe(false);
    expect(list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'agentos.work.v1' }),
      expect.objectContaining({ id: 'agentos.adapter.v1' }),
    ]));
  });
});
