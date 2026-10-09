import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileIdempotencyStore, SqliteIdempotencyStore } from '../../src/payments/idempotency-store.js';

function tempPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-idempotency-')), name);
}

describe('payment idempotency stores', () => {
  test.each([
    ['file', () => new FileIdempotencyStore({ filePath: tempPath('payment-idempotency.json') })],
    ['sqlite', () => new SqliteIdempotencyStore({ dbPath: tempPath('payment-ledger.sqlite') })],
  ])('%s store releases pending reservations', (_name, createStore) => {
    const store = createStore();
    try {
      expect(store.reserve('checkout:key', { requestFingerprint: 'fp-1' })).toBe(true);
      expect(store.get('checkout:key')).toMatchObject({ pending: true });
      expect(store.release('checkout:key')).toBe(true);
      expect(store.get('checkout:key')).toBeUndefined();
      expect(store.release('checkout:key')).toBe(false);
    } finally {
      store.close();
    }
  });

  test.each([
    ['file', () => new FileIdempotencyStore({ filePath: tempPath('payment-idempotency.json') })],
    ['sqlite', () => new SqliteIdempotencyStore({ dbPath: tempPath('payment-ledger.sqlite') })],
  ])('%s store preserves completed records when release is called', (_name, createStore) => {
    const store = createStore();
    try {
      expect(store.reserve('key', { requestFingerprint: 'fp' })).toBe(true);
      store.set('key', { orderId: 'order-1' });
      expect(store.get('key')).toEqual({ orderId: 'order-1' });
      expect(store.release('key')).toBe(false);
      expect(store.get('key')).toEqual({ orderId: 'order-1' });
    } finally {
      store.close();
    }
  });
});
