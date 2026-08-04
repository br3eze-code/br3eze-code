'use strict';

import { jest } from '@jest/globals';
import PesaPalProvider from '../../../src/payments/providers/pesapay-provider.js';

function makeProvider(config = {}) {
  return new PesaPalProvider({
    pesapalConsumerKey: 'key',
    pesapalConsumerSecret: 'secret',
    ...config,
  });
}

describe('PesaPalProvider', () => {
  describe('base URL selection', () => {
    test('defaults to the sandbox endpoint', () => {
      expect(makeProvider().baseUrl).toBe('https://cybqa.pesapal.com/pesapalv3');
    });

    test('uses the production endpoint when configured', () => {
      expect(makeProvider({ pesapalEnvironment: 'production' }).baseUrl).toBe(
        'https://pay.pesapal.com/v3'
      );
    });
  });

  describe('formatPhoneNumber', () => {
    let provider;
    beforeEach(() => {
      provider = makeProvider();
    });

    test('returns an empty string for a missing phone number', () => {
      expect(provider.formatPhoneNumber('')).toBe('');
      expect(provider.formatPhoneNumber(undefined)).toBe('');
    });

    test.each([
      ['0771234567', '+263771234567'],
      ['771234567', '+263771234567'],
      ['263771234567', '+263771234567'],
      ['+263 77 123 4567', '+263771234567'],
    ])('normalizes %s to %s', (input, expected) => {
      expect(provider.formatPhoneNumber(input)).toBe(expected);
    });
  });

  describe('authenticate', () => {
    let provider;
    beforeEach(() => {
      provider = makeProvider();
    });

    test('requests a token using Basic auth built from the consumer key/secret', async () => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({ token: 'tok_123' });

      const token = await provider.authenticate();

      const expectedAuth = Buffer.from('key:secret').toString('base64');
      expect(provider.makeRequest).toHaveBeenCalledWith(
        '/api/Auth/RequestToken',
        'POST',
        null,
        expect.objectContaining({ Authorization: `Basic ${expectedAuth}` })
      );
      expect(token).toBe('tok_123');
    });

    test('caches the token until it expires, avoiding a second network call', async () => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({ token: 'tok_123' });

      await provider.authenticate();
      await provider.authenticate();

      expect(provider.makeRequest).toHaveBeenCalledTimes(1);
    });

    test('re-authenticates once the cached token has expired', async () => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({ token: 'tok_123' });
      await provider.authenticate();

      provider.tokenExpiry = Date.now() - 1;
      await provider.authenticate();

      expect(provider.makeRequest).toHaveBeenCalledTimes(2);
    });

    test('throws when the API responds without a token', async () => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({});
      await expect(provider.authenticate()).rejects.toThrow('No token received from PesaPal');
    });
  });

  describe('registerIPN / getRegisteredIPNs', () => {
    let provider;
    beforeEach(() => {
      provider = makeProvider();
      jest.spyOn(provider, 'authenticate').mockResolvedValue('tok_123');
    });

    test('registerIPN posts the URL and stores the returned ipn_id on config', async () => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({ ipn_id: 'ipn_1', url: 'https://cb' });

      const result = await provider.registerIPN('https://cb', 'POST');

      expect(provider.makeRequest).toHaveBeenCalledWith(
        '/api/URLSetup/RegisterIPN',
        'POST',
        { url: 'https://cb', ipn_notification_type: 'POST' },
        expect.objectContaining({ Authorization: 'Bearer tok_123' })
      );
      expect(provider.config.ipnId).toBe('ipn_1');
      expect(result.ipn_id).toBe('ipn_1');
    });

    test('getRegisteredIPNs authenticates then fetches the IPN list', async () => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue([{ id: 'ipn_1' }]);
      const result = await provider.getRegisteredIPNs();
      expect(provider.makeRequest).toHaveBeenCalledWith(
        '/api/URLSetup/GetIpnList',
        'GET',
        null,
        expect.objectContaining({ Authorization: 'Bearer tok_123' })
      );
      expect(result).toEqual([{ id: 'ipn_1' }]);
    });
  });

  describe('createPayment', () => {
    let provider;
    beforeEach(() => {
      provider = makeProvider();
      jest.spyOn(provider, 'authenticate').mockResolvedValue('tok_123');
    });

    test('rejects a zero or negative amount before making any network call', async () => {
      await expect(provider.createPayment({ amount: 0 })).rejects.toThrow('Invalid amount');
      await expect(provider.createPayment({ amount: -5 })).rejects.toThrow('Invalid amount');
      expect(provider.authenticate).not.toHaveBeenCalled();
    });

    test('submits an order and normalizes the response', async () => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({
        order_tracking_id: 'OT-1',
        merchant_reference: 'REF-1',
        redirect_url: 'https://pesapal/redirect',
      });

      const result = await provider.createPayment({
        amount: 5,
        reference: 'REF-1',
        customerPhone: '0771234567',
        customerName: 'Jane Doe',
        notificationId: 'ipn_1',
      });

      expect(provider.makeRequest).toHaveBeenCalledWith(
        '/api/Transactions/SubmitOrderRequest',
        'POST',
        expect.objectContaining({
          id: 'REF-1',
          notification_id: 'ipn_1',
          billing_address: expect.objectContaining({
            phone_number: '+263771234567',
            first_name: 'Jane',
            last_name: 'Doe',
          }),
        }),
        expect.objectContaining({ Authorization: 'Bearer tok_123' })
      );
      expect(result).toMatchObject({
        success: true,
        orderTrackingId: 'OT-1',
        merchantReference: 'REF-1',
        redirectUrl: 'https://pesapal/redirect',
        status: 'pending',
      });
    });

    test('propagates the underlying network error', async () => {
      jest.spyOn(provider, 'makeRequest').mockRejectedValue(new Error('PesaPal is down'));
      await expect(provider.createPayment({ amount: 5 })).rejects.toThrow('PesaPal is down');
    });
  });

  describe('verifyPayment', () => {
    let provider;
    beforeEach(() => {
      provider = makeProvider();
      jest.spyOn(provider, 'authenticate').mockResolvedValue('tok_123');
    });

    test('requires an orderTrackingId', async () => {
      await expect(provider.verifyPayment()).rejects.toThrow('Order tracking ID is required');
    });

    test.each([
      ['COMPLETED', 'completed', true],
      ['FAILED', 'failed', false],
      ['INVALID', 'failed', false],
      ['REVERSED', 'refunded', false],
      ['PENDING', 'pending', false],
    ])('maps PesaPal status %s to %s (success=%s)', async (raw, mapped, success) => {
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({
        status: raw,
        order_tracking_id: 'OT-1',
        merchant_reference: 'REF-1',
        amount: '5.00',
        currency: 'USD',
      });

      const result = await provider.verifyPayment('OT-1');
      expect(result.status).toBe(mapped);
      expect(result.success).toBe(success);
    });
  });

  describe('refund', () => {
    test('sends the amount as a fixed 2-decimal string and reports success from the response', async () => {
      const provider = makeProvider();
      jest.spyOn(provider, 'authenticate').mockResolvedValue('tok_123');
      jest.spyOn(provider, 'makeRequest').mockResolvedValue({
        status: 'SUCCESS',
        refund_id: 'rf_1',
        amount: '5.00',
        message: 'ok',
      });

      const result = await provider.refund('OT-1', 5, 'customer request');

      expect(provider.makeRequest).toHaveBeenCalledWith(
        '/api/Transactions/RefundRequest',
        'POST',
        expect.objectContaining({ order_tracking_id: 'OT-1', amount: '5.00', reason: 'customer request' }),
        expect.anything()
      );
      expect(result).toEqual({ success: true, refundId: 'rf_1', status: 'success', amount: 5, message: 'ok' });
    });
  });

  describe('verifyWebhook', () => {
    let provider;
    beforeEach(() => {
      provider = makeProvider();
    });

    test('returns false when the payload has no order tracking id in any known field', async () => {
      await expect(provider.verifyWebhook({}, {})).resolves.toBe(false);
    });

    test('accepts snake_case, camel PascalCase, or bare "id" for the tracking id field', async () => {
      jest.spyOn(provider, 'verifyPayment').mockResolvedValue({ orderTrackingId: 'OT-1' });
      await expect(provider.verifyWebhook({ order_tracking_id: 'OT-1' }, {})).resolves.toBe(true);
      await expect(provider.verifyWebhook({ OrderTrackingId: 'OT-1' }, {})).resolves.toBe(true);
      await expect(provider.verifyWebhook({ id: 'OT-1' }, {})).resolves.toBe(true);
    });

    test('returns false when verifyPayment fails to confirm the same tracking id', async () => {
      jest.spyOn(provider, 'verifyPayment').mockResolvedValue({ orderTrackingId: 'OT-DIFFERENT' });
      await expect(provider.verifyWebhook({ order_tracking_id: 'OT-1' }, {})).resolves.toBe(false);
    });

    test('returns false (not a throw) when verifyPayment itself throws', async () => {
      jest.spyOn(provider, 'verifyPayment').mockRejectedValue(new Error('API down'));
      await expect(provider.verifyWebhook({ order_tracking_id: 'OT-1' }, {})).resolves.toBe(false);
    });
  });

  describe('processWebhook', () => {
    let provider;
    beforeEach(() => {
      provider = makeProvider();
    });

    test.each([
      ['COMPLETED', 'payment_success'],
      ['FAILED', 'payment_failed'],
      ['REVERSED', 'payment_reversed'],
      ['PENDING', 'payment_pending'],
      [undefined, 'payment_pending'],
      ['SOMETHING_ELSE', 'payment_update'],
    ])('maps IPN status %s to event type %s', async (status, expectedType) => {
      const payload = { status, order_tracking_id: 'OT-1', amount: '5.00' };
      const result = await provider.processWebhook(payload);
      expect(result.type).toBe(expectedType);
    });

    test('extracts fields from snake_case payload keys', async () => {
      const result = await provider.processWebhook({
        status: 'COMPLETED',
        order_tracking_id: 'OT-1',
        merchant_reference: 'REF-1',
        payment_option: 'Visa',
        amount: '5.00',
        currency: 'USD',
        confirmation_code: 'CONF1',
        phone: '+263771234567',
        first_name: 'Jane',
        last_name: 'Doe',
      });

      expect(result).toMatchObject({
        orderTrackingId: 'OT-1',
        merchantReference: 'REF-1',
        paymentMethod: 'Visa',
        amount: 5,
        currency: 'USD',
        confirmationCode: 'CONF1',
        customerPhone: '+263771234567',
        customerName: 'Jane Doe',
      });
    });

    test('extracts fields from PascalCase payload keys (alternate IPN format)', async () => {
      const result = await provider.processWebhook({
        status: 'COMPLETED',
        OrderTrackingId: 'OT-2',
        MerchantReference: 'REF-2',
        PaymentOption: 'Mastercard',
        Amount: '9.50',
        Currency: 'USD',
        ConfirmationCode: 'CONF2',
      });

      expect(result).toMatchObject({
        orderTrackingId: 'OT-2',
        merchantReference: 'REF-2',
        paymentMethod: 'Mastercard',
        amount: 9.5,
        currency: 'USD',
        confirmationCode: 'CONF2',
      });
    });
  });
});
