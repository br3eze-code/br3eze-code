'use strict';

jest.mock('../../../src/payments/providers/pesapay-provider');

const PesaPalProvider = require('../../../src/payments/providers/pesapay-provider');
const PesaPalIntegration = require('../../../src/payments/pesapay-integration');

function makeFakeDb(initialTx = {}) {
  const transactions = { ...initialTx };
  const vouchers = {};

  const txDoc = id => ({
    update: jest.fn(async data => {
      transactions[id] = { ...(transactions[id] || {}), ...data };
    }),
    get: jest.fn(async () => ({ data: () => transactions[id] })),
    set: jest.fn(async data => {
      transactions[id] = data;
    }),
  });

  const voucherDoc = code => ({
    set: jest.fn(async data => {
      vouchers[code] = data;
    }),
  });

  return {
    _transactions: transactions,
    _vouchers: vouchers,
    collection: jest.fn(name => ({
      doc: jest.fn(id => (name === 'vouchers' ? voucherDoc(id) : txDoc(id))),
    })),
  };
}

describe('PesaPalIntegration', () => {
  let integration;
  let providerInstance;

  beforeEach(() => {
    PesaPalProvider.mockClear();
    integration = new PesaPalIntegration({});
    providerInstance = integration.provider;
    providerInstance.config = {};
  });

  describe('initialize', () => {
    test('registers an IPN when none is configured and an ipnUrl is supplied', async () => {
      providerInstance.getRegisteredIPNs = jest.fn().mockResolvedValue([]);
      providerInstance.registerIPN = jest.fn().mockResolvedValue({ ipn_id: 'ipn_123' });

      const result = await integration.initialize('https://example.com/ipn');

      expect(providerInstance.registerIPN).toHaveBeenCalledWith('https://example.com/ipn', 'POST');
      expect(providerInstance.config.ipnId).toBe('ipn_123');
      expect(result).toBe(true);
    });

    test('skips registration when an IPN ID is already configured', async () => {
      providerInstance.config.ipnId = 'existing_ipn';
      providerInstance.getRegisteredIPNs = jest.fn().mockResolvedValue([]);
      providerInstance.registerIPN = jest.fn();

      await integration.initialize('https://example.com/ipn');

      expect(providerInstance.registerIPN).not.toHaveBeenCalled();
    });

    test('returns false instead of throwing when the provider call fails', async () => {
      providerInstance.getRegisteredIPNs = jest.fn().mockRejectedValue(new Error('network down'));

      await expect(integration.initialize('https://example.com/ipn')).resolves.toBe(false);
    });
  });

  describe('createVoucherPurchase', () => {
    test('builds a BR3EZE- reference and returns the payment merged with it', async () => {
      providerInstance.createPayment = jest.fn().mockResolvedValue({
        orderTrackingId: 'OT-1',
        redirectUrl: 'https://pesapal/redirect',
      });

      const result = await integration.createVoucherPurchase('u1', '1Day', 5, { email: 'a@b.com' });

      expect(providerInstance.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 5, currency: 'USD', customerEmail: 'a@b.com' })
      );
      expect(result.success).toBe(true);
      expect(result.orderTrackingId).toBe('OT-1');
      expect(result.reference).toMatch(/^BR3EZE-u1-\d+$/);
    });

    test('persists a pending transaction keyed by orderTrackingId when a database is attached', async () => {
      const db = makeFakeDb();
      integration.setDatabase(db);
      providerInstance.createPayment = jest.fn().mockResolvedValue({ orderTrackingId: 'OT-1' });

      await integration.createVoucherPurchase('u1', '1Day', 5);

      expect(db._transactions['OT-1']).toMatchObject({
        userId: 'u1',
        voucherType: '1Day',
        amount: 5,
        status: 'pending',
        provider: 'pesapal',
      });
    });

    test('propagates errors from the provider', async () => {
      providerInstance.createPayment = jest.fn().mockRejectedValue(new Error('invalid amount'));
      await expect(integration.createVoucherPurchase('u1', '1Day', -1)).rejects.toThrow('invalid amount');
    });
  });

  describe('handleSuccessfulPayment', () => {
    test('without a database attached, resolves undefined and generates no voucher', async () => {
      const result = await integration.handleSuccessfulPayment({
        orderTrackingId: 'OT-1',
        amount: 5,
        paymentMethod: 'mpesa',
        confirmationCode: 'CONF1',
      });
      expect(result).toBeUndefined();
    });

    test('with a database, completes the transaction and generates an active voucher', async () => {
      const db = makeFakeDb({ 'OT-1': { userId: 'u1', voucherType: '1Week' } });
      integration.setDatabase(db);

      const result = await integration.handleSuccessfulPayment({
        orderTrackingId: 'OT-1',
        amount: 5,
        paymentMethod: 'mpesa',
        confirmationCode: 'CONF1',
      });

      expect(db._transactions['OT-1']).toMatchObject({ status: 'completed', paymentMethod: 'mpesa' });
      expect(result.success).toBe(true);
      expect(result.voucherCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(db._vouchers[result.voucherCode]).toMatchObject({
        type: '1Week',
        userId: 'u1',
        status: 'active',
        used: false,
      });
    });

    test('sends a Telegram message with the voucher code when a bot is attached', async () => {
      const db = makeFakeDb({ 'OT-1': { userId: 'u1', voucherType: '1Day' } });
      integration.setDatabase(db);
      const sendMessage = jest.fn().mockResolvedValue();
      integration.setTelegramBot({ sendMessage });

      const result = await integration.handleSuccessfulPayment({
        orderTrackingId: 'OT-1',
        amount: 5,
        paymentMethod: 'mpesa',
        confirmationCode: 'CONF1',
      });

      expect(sendMessage).toHaveBeenCalledWith(
        'u1',
        expect.stringContaining(result.voucherCode),
        { parse_mode: 'Markdown' }
      );
    });

    test('with a database but no Telegram bot, still succeeds without sending a message', async () => {
      const db = makeFakeDb({ 'OT-1': { userId: 'u1', voucherType: '1Day' } });
      integration.setDatabase(db);

      await expect(
        integration.handleSuccessfulPayment({
          orderTrackingId: 'OT-1',
          amount: 5,
          paymentMethod: 'mpesa',
          confirmationCode: 'CONF1',
        })
      ).resolves.toMatchObject({ success: true });
    });
  });

  describe('generateVoucherCode / calculateExpiry', () => {
    test('generateVoucherCode returns an XXXX-XXXX code', () => {
      expect(integration.generateVoucherCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    test.each([
      ['1Hour', 1],
      ['1Day', 24],
      ['1Week', 24 * 7],
      ['1Month', 24 * 30],
      ['bogus', 24],
    ])('calculateExpiry(%s) is %d hours out', (type, hours) => {
      const before = Date.now();
      const expiry = integration.calculateExpiry(type);
      const deltaMs = expiry.getTime() - before;
      expect(deltaMs).toBeGreaterThan(hours * 60 * 60 * 1000 - 1000);
      expect(deltaMs).toBeLessThanOrEqual(hours * 60 * 60 * 1000 + 1000);
    });
  });

  describe('getTransactionStatus / processRefund', () => {
    test('getTransactionStatus delegates to provider.verifyPayment', async () => {
      providerInstance.verifyPayment = jest.fn().mockResolvedValue({ success: true });
      const result = await integration.getTransactionStatus('OT-1');
      expect(providerInstance.verifyPayment).toHaveBeenCalledWith('OT-1');
      expect(result).toEqual({ success: true });
    });

    test('processRefund delegates to provider.refund', async () => {
      providerInstance.refund = jest.fn().mockResolvedValue({ success: true, refundId: 'r1' });
      const result = await integration.processRefund('OT-1', 5, 'customer request');
      expect(providerInstance.refund).toHaveBeenCalledWith('OT-1', 5, 'customer request');
      expect(result).toEqual({ success: true, refundId: 'r1' });
    });
  });
});
