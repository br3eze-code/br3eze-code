import { describe, expect, test, jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createPaymentPlatform } from '../src/payments/payment-platform.js';
import { PaymentProviderAdapter } from '../src/payments/provider-adapter.js';
import {
  normalizePaymentRequest,
  createIdempotencyKey,
  sanitizeMetadata,
} from '../src/payments/payment-guards.js';
import { IdentityLinkingService } from '../src/services/identity-linking.js';
import { getLinkPrompt, getLoginUrl } from '../src/core/authPrompt.js';

describe('payment guards', () => {
  test('normalizes and validates server-facing payment input', () => {
    const request = normalizePaymentRequest({ amount: 10.5, currency: 'usd', reference: 'order-1', metadata: { apiKey: 'secret', plan: 'basic' } });
    expect(request.amountMinor).toBe(1050);
    expect(request.currency).toBe('USD');
    expect(request.metadata).toEqual({ apiKey: '[redacted]', plan: 'basic' });
    expect(() => normalizePaymentRequest({ amount: 0, reference: 'x' })).toThrow();
  });

  test('deduplicates provider create requests by reference', async () => {
    const testState = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-payment-test-'));
    const provider = new PaymentProviderAdapter({ id: 'test', capabilities: { createPayment: true } });
    provider.createPayment = jest.fn().mockResolvedValue({ success: true, status: 'succeeded', transactionId: 'tx-1' });
    const platform = createPaymentPlatform({
      defaultCurrency: 'USD',
      idempotencyOptions: { dbPath: path.join(testState, 'payment-ledger.sqlite') },
      adapters: [provider],
    });
    const first = await platform.createPayment('test', { amount: 10, reference: 'order-1' });
    const second = await platform.createPayment('test', { amount: 10, reference: 'order-1' });
    expect(first).toEqual(second);
    expect(provider.createPayment).toHaveBeenCalledTimes(1);
    platform.close();
  });

  test('requires webhook verification and a refund reason', async () => {
    const provider = new PaymentProviderAdapter({ id: 'test', capabilities: { webhooks: true, refunds: true } });
    provider.verifyWebhook = jest.fn().mockResolvedValue(false);
    provider.processWebhook = jest.fn();
    provider.refund = jest.fn();
    const platform = createPaymentPlatform({ adapters: [provider] });
    await expect(platform.webhook({ provider: 'test', payload: {}, headers: {} })).rejects.toThrow(/verification/);
    await expect(platform.refund('test', 'tx-1', 2)).rejects.toThrow(/reason/);
  });

  test('redacts sensitive nested metadata', () => {
    expect(sanitizeMetadata({ nested: { accessToken: 'x', safe: true } })).toEqual({ nested: { accessToken: '[redacted]', safe: true } });
    expect(createIdempotencyKey('test', 'order-1')).toHaveLength(64);
  });
});

describe('identity linking', () => {
  test('prevents cross-account identity takeover and expires tokens', async () => {
    let now = 1000;
    const service = new IdentityLinkingService({ now: () => now, ttlMs: 100 });
    await service.link({ userId: 'u1', identity: { provider: 'telegram', subject: '123' } });
    await expect(service.link({ userId: 'u2', identity: { provider: 'telegram', subject: '123' } })).rejects.toThrow(/another account/);
    const issued = await service.issueLinkToken({ userId: 'u1', identity: { provider: 'github', subject: 'octo' } });
    now = 1200;
    await expect(service.consumeLinkToken(issued.token, { userId: 'u1' })).rejects.toThrow(/expired/);
  });
});

test('login and link prompts contain state but no credentials', () => {
  expect(getLoginUrl('opaque-state')).toContain('state=opaque-state');
  expect(getLinkPrompt('telegram', 'opaque-state')).toContain('Never send passwords');
});
