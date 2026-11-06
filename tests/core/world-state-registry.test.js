import { describe, expect, test } from '@jest/globals';
import { WorldStateRegistry } from '../../src/core/world-state/WorldStateRegistry.js';

describe('WorldStateRegistry', () => {
  test('unknown state is explicit and never assumed healthy', () => {
    const state = new WorldStateRegistry();
    expect(state.get('router-1', 'connectivity')).toMatchObject({
      status: 'unknown',
      value: null,
      reason: 'never_observed',
    });
    expect(() => state.requireFresh('router-1', 'connectivity')).toThrow('world-state observation is unknown');
    expect(() => state.get('router-1', 'connectivity', { maxAgeMs: 0 })).toThrow('maxAgeMs must be a positive');
  });

  test('records an observation with provenance, freshness and monotonic version', () => {
    let now = Date.parse('2026-11-06T10:00:00.000Z');
    const state = new WorldStateRegistry({ clock: () => now, defaultMaxAgeMs: 1000 });
    const first = state.record({
      resourceId: 'router-1',
      key: 'connectivity',
      value: { online: true },
      source: 'routeros.read-only',
      confidence: 0.95,
    });
    expect(first).toMatchObject({ status: 'current', version: 1, source: 'routeros.read-only', confidence: 0.95 });
    first.value.online = false;
    expect(state.requireFresh('router-1', 'connectivity').value).toEqual({ online: true });

    state.record({ resourceId: 'router-1', key: 'connectivity', value: { online: false }, source: 'routeros.read-only' });
    expect(state.get('router-1', 'connectivity')).toMatchObject({ status: 'current', version: 2, value: { online: false } });

    now += 1001;
    expect(state.get('router-1', 'connectivity')).toMatchObject({ status: 'stale', reason: 'observation_expired' });
    expect(() => state.requireFresh('router-1', 'connectivity')).toThrow('world-state observation is stale');
  });

  test('rejects invalid provenance, confidence, freshness and future observations', () => {
    const now = Date.parse('2026-11-06T10:00:00.000Z');
    const state = new WorldStateRegistry({ clock: () => now });
    const base = { resourceId: 'router-1', key: 'connectivity', value: true, source: 'routeros' };
    expect(() => state.record({ ...base, source: '' })).toThrow('source must be a non-empty identifier');
    expect(() => state.record({ ...base, confidence: 2 })).toThrow('confidence must be a number');
    expect(() => state.record({ ...base, maxAgeMs: 0 })).toThrow('maxAgeMs must be a positive');
    expect(() => state.record({ ...base, observedAt: '2026-11-06T10:01:00.000Z' })).toThrow('too far in the future');
  });

  test('rejects invalid snapshot freshness overrides', () => {
    const state = new WorldStateRegistry();
    expect(() => state.snapshot('router-1', { maxAgeMs: 0 })).toThrow('maxAgeMs must be a positive');
  });

  test('limits new observations and supports resource-scoped clearing', () => {
    const state = new WorldStateRegistry({ maxObservations: 1 });
    state.record({ resourceId: 'router-1', key: 'connectivity', value: true, source: 'routeros' });
    expect(() => state.record({ resourceId: 'router-2', key: 'connectivity', value: true, source: 'routeros' }))
      .toThrow('observation limit reached');
    expect(state.clear('router-1')).toBe(true);
    expect(state.get('router-1', 'connectivity').status).toBe('unknown');
  });
});
