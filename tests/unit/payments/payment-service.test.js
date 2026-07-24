'use strict';

const PaymentService = require('../../../src/payments/payment-service');

function makeFakeGateway() {
  return {
    createPayment: jest.fn(),
    verifyPayment: jest.fn(),
    getAvailableMethods: jest.fn(),
    refund: jest.fn(),
  };
}

function makeFakeDb() {
  const store = {};
  const docApi = (collectionName, id) => ({
    set: jest.fn(async data => {
      store[`${collectionName}/${id}`] = data;
    }),
    update: jest.fn(async data => {
      store[`${collectionName}/${id}`] = { ...(store[`${collectionName}/${id}`] || {}), ...data };
    }),
    get: jest.fn(async () => ({ data: () => store[`${collectionName}/${id}`] })),
    collection: jest.fn(subName => docApi(`${collectionName}/${id}/${subName}`, 'auto')),
    add: jest.fn(async data => {
      store[`${collectionName}/${id}/auto`] = data;
    }),
  });

  return {
    _store: store,
    collection: jest.fn(name => ({
      doc: jest.fn(id => docApi(name, id)),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({
        docs: [{ id: 'tx1', data: () => ({ userId: 'u1', amount: 5 }) }],
      })),
    })),
  };
}

describe('PaymentService', () => {
  let gateway;
  let service;

  beforeEach(() => {
    gateway = makeFakeGateway();
    service = new PaymentService(gateway);
  });

  describe('generateVoucherCode', () => {
    test('produces an 8-char alphanumeric code split XXXX-XXXX from the safe charset', () => {
      const code = service.generateVoucherCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    });

    test('does not use ambiguous characters (0, O, 1, I)', () => {
      for (let i = 0; i < 50; i++) {
        expect(service.generateVoucherCode()).not.toMatch(/[01OI]/);
      }
    });
  });

  describe('calculateExpiry', () => {
    test.each([
      ['1Hour', 1],
      ['1Day', 24],
      ['1Week', 24 * 7],
      ['1Month', 24 * 30],
      ['unknown-type', 24],
      [undefined, 24],
    ])('type %s expires %d hours from now', (type, hours) => {
      const before = Date.now();
      const expiry = service.calculateExpiry(type);
      const deltaMs = expiry.getTime() - before;
      expect(deltaMs).toBeGreaterThan(hours * 60 * 60 * 1000 - 1000);
      expect(deltaMs).toBeLessThanOrEqual(hours * 60 * 60 * 1000 + 1000);
    });
  });

  describe('purchaseVoucher', () => {
    test('creates a payment via the gateway with a generated reference and returns it merged in', async () => {
      gateway.createPayment.mockResolvedValue({ success: true, transactionId: 'tx1', status: 'pending' });

      const result = await service.purchaseVoucher({
        userId: 'u1',
        voucherType: '1Day',
        amount: 5,
        currency: 'USD',
        paymentMethod: 'ecocash',
        customerPhone: '0771234567',
      });

      expect(gateway.createPayment).toHaveBeenCalledWith(
        'ecocash',
        expect.objectContaining({
          amount: 5,
          currency: 'USD',
          phoneNumber: '0771234567',
          metadata: expect.objectContaining({ userId: 'u1', voucherType: '1Day' }),
        })
      );
      expect(result.transactionId).toBe('tx1');
      expect(result.reference).toMatch(/^VOUCHER-\d+-[a-z0-9]+$/);
    });

    test('works without a database attached (no throw, no persistence attempted)', async () => {
      gateway.createPayment.mockResolvedValue({ success: true, transactionId: 'tx1', status: 'pending' });
      await expect(
        service.purchaseVoucher({ userId: 'u1', voucherType: '1Day', amount: 5, currency: 'USD', paymentMethod: 'stripe' })
      ).resolves.toBeDefined();
    });

    test('persists the transaction when a database is attached', async () => {
      const db = makeFakeDb();
      service.setDatabase(db);
      gateway.createPayment.mockResolvedValue({ success: true, transactionId: 'tx1', status: 'pending' });

      await service.purchaseVoucher({
        userId: 'u1',
        voucherType: '1Day',
        amount: 5,
        currency: 'USD',
        paymentMethod: 'stripe',
      });

      expect(db._store['transactions/tx1']).toMatchObject({ userId: 'u1', voucherType: '1Day', status: 'pending' });
    });
  });

  describe('processSuccessfulPayment', () => {
    test('throws when the underlying transaction did not succeed', async () => {
      gateway.verifyPayment.mockResolvedValue({ success: false });
      await expect(service.processSuccessfulPayment('tx1', 'stripe')).rejects.toThrow(
        'Payment not completed'
      );
    });

    test('without a database, still generates and returns a voucher (nothing is persisted)', async () => {
      gateway.verifyPayment.mockResolvedValue({ success: true, amount: 5, currency: 'USD', metadata: {} });
      const result = await service.processSuccessfulPayment('tx1', 'stripe');
      expect(result.success).toBe(true);
      expect(result.voucher.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    test('generates and stores a voucher, and updates the user wallet, when a database is attached', async () => {
      const db = makeFakeDb();
      service.setDatabase(db);
      gateway.verifyPayment.mockResolvedValue({
        success: true,
        amount: 5,
        currency: 'USD',
        metadata: { userId: 'u1', voucherType: '1Week' },
      });

      const result = await service.processSuccessfulPayment('tx1', 'stripe');

      expect(result.success).toBe(true);
      expect(result.voucher.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(result.voucher.type).toBe('1Week');
      expect(db._store['transactions/tx1']).toMatchObject({ status: 'completed' });
      expect(db._store[`vouchers/${result.voucher.code}`]).toMatchObject({ type: '1Week', used: false });
    });

    test('defaults voucher type to 1Day when transaction metadata omits it', async () => {
      const db = makeFakeDb();
      service.setDatabase(db);
      gateway.verifyPayment.mockResolvedValue({ success: true, amount: 5, currency: 'USD', metadata: {} });

      const result = await service.processSuccessfulPayment('tx1', 'stripe');
      expect(result.voucher.type).toBe('1Day');
    });
  });

  describe('getAvailablePaymentMethods', () => {
    test('delegates directly to the gateway', async () => {
      gateway.getAvailableMethods.mockResolvedValue([{ id: 'stripe' }]);
      const result = await service.getAvailablePaymentMethods({ country: 'US' });
      expect(gateway.getAvailableMethods).toHaveBeenCalledWith({ country: 'US' });
      expect(result).toEqual([{ id: 'stripe' }]);
    });
  });

  describe('processRefund', () => {
    test('delegates to the gateway and returns its result when there is no database', async () => {
      gateway.refund.mockResolvedValue({ success: true, refundId: 'rf_1' });
      const result = await service.processRefund('tx1', 'stripe', 5, 'customer request');
      expect(gateway.refund).toHaveBeenCalledWith('stripe', 'tx1', 5, 'customer request');
      expect(result).toEqual({ success: true, refundId: 'rf_1' });
    });

    test('records the refund on the transaction when a database is attached', async () => {
      const db = makeFakeDb();
      service.setDatabase(db);
      gateway.refund.mockResolvedValue({ success: true, refundId: 'rf_1' });

      await service.processRefund('tx1', 'stripe', 5, 'customer request');

      expect(db._store['transactions/tx1']).toMatchObject({
        refunded: true,
        refundAmount: 5,
        refundReason: 'customer request',
        refundId: 'rf_1',
      });
    });
  });

  describe('getTransactionHistory', () => {
    test('returns an empty array when there is no database', async () => {
      await expect(service.getTransactionHistory('u1')).resolves.toEqual([]);
    });

    test('maps Firestore-style docs into plain objects when a database is attached', async () => {
      const db = makeFakeDb();
      service.setDatabase(db);
      const result = await service.getTransactionHistory('u1');
      expect(result).toEqual([{ id: 'tx1', userId: 'u1', amount: 5 }]);
    });
  });
});
