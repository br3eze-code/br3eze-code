import { describe, expect, test, jest } from '@jest/globals';
import { PaymentGateway } from '../src/payments/payment-gateway.js';
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
    const gateway = new PaymentGateway({ defaultCurrency: 'USD' });
    const provider = { createPayment: jest.fn().mockResolvedValue({ success: true, status: 'succeeded', transactionId: 'tx-1' }) };
    gateway.providers.set('test', provider);
    const first = await gateway.createPayment('test', { amount: 10, reference: 'order-1' });
    const second = await gateway.createPayment('test', { amount: 10, reference: 'order-1' });
    expect(first).toEqual(second);
    expect(provider.createPayment).toHaveBeenCalledTimes(1);
  });

  test('requires webhook verification and a refund reason', async () => {
    const gateway = new PaymentGateway();
    gateway.providers.set('test', {
      verifyWebhook: jest.fn().mockResolvedValue(false),
      processWebhook: jest.fn(),
      refund: jest.fn(),
    });
    await expect(gateway.handleWebhook('test', {}, {})).rejects.toThrow(/signature/);
    await expect(gateway.refund('test', 'tx-1', 2)).rejects.toThrow(/reason/);
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
