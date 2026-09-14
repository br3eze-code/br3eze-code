import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { FileIdempotencyStore } from '../../src/payments/idempotency-store.js';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('idempotency store', () => {
  test('releases a failed reservation so the key can be retried', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-idempotency-'));
    tempDirs.push(dir);
    const store = new FileIdempotencyStore({ filePath: path.join(dir, 'idempotency.json') });

    expect(store.reserve('k1', { requestFingerprint: 'abc' })).toBe(true);
    expect(store.get('k1')).toMatchObject({ pending: true, metadata: { requestFingerprint: 'abc' } });
    expect(store.release('k1')).toBe(true);
    expect(store.get('k1')).toBeUndefined();
    expect(store.reserve('k1', { requestFingerprint: 'abc' })).toBe(true);
  });

  test('returns the exact completed result for a retry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-idempotency-'));
    tempDirs.push(dir);
    const store = new FileIdempotencyStore({ filePath: path.join(dir, 'idempotency.json') });
    const result = { orderId: 'order-1', requestFingerprint: 'abc' };

    expect(store.reserve('k2', { requestFingerprint: 'abc' })).toBe(true);
    store.set('k2', result);
    expect(store.get('k2')).toEqual(result);
  });
});
