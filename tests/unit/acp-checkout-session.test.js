import { describe, expect, test } from '@jest/globals';
import {
  assertCheckoutTransition,
  createCheckoutSession,
  fingerprintRequest,
  idempotencyResult,
  validateIdempotencyKey,
} from '../../src/commerce/acp/checkout-session.js';

describe('ACP checkout session boundary', () => {
  test('requires a valid idempotency key', () => {
    expect(() => validateIdempotencyKey('')).toThrow();
    expect(() => validateIdempotencyKey('bad key')).toThrow();
    expect(validateIdempotencyKey('order-123:attempt-1')).toBe('order-123:attempt-1');
  });

  test('creates a deterministic request fingerprint', () => {
    const a = fingerprintRequest({ merchantId: 'm1', currency: 'USD', items: [{ id: 'p1', qty: 1 }] });
    const b = fingerprintRequest({ merchantId: 'm1', currency: 'USD', items: [{ id: 'p1', qty: 1 }] });
    expect(a).toBe(b);
  });

  test('creates a pending checkout session', () => {
    const session = createCheckoutSession({
      idempotencyKey: 'req-1',
      merchantId: 'br3eze',
      currency: 'USD',
      items: [{ id: 'p1', quantity: 1 }],
      totals: { total: 10 },
    });
    expect(session.id).toMatch(/^cs_/);
    expect(session.status).toBe('pending');
    expect(session.requestFingerprint).toHaveLength(64);
  });

  test('replays the same request and rejects a key reused for another request', () => {
    const session = createCheckoutSession({ idempotencyKey: 'req-2', merchantId: 'br3eze', items: [{ id: 'p1', quantity: 1 }] });
    const same = idempotencyResult(session, session.requestFingerprint);
    expect(same.state).toBe('replay');

    const conflict = idempotencyResult(session, 'different-fingerprint');
    expect(conflict.state).toBe('conflict');
  });

  test('enforces the checkout lifecycle', () => {
    expect(assertCheckoutTransition('pending', 'requires_payment')).toBe(true);
    expect(assertCheckoutTransition('paid', 'processing')).toBe(true);
    expect(assertCheckoutTransition('processing', 'fulfilled')).toBe(true);
    expect(() => assertCheckoutTransition('fulfilled', 'paid')).toThrow();
  });
});
