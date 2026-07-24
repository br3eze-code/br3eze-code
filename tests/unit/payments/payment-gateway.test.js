'use strict';

const {
  PaymentGateway,
  StripeProvider,
  EcoCashProvider,
  NetOneProvider,
  PayNowProvider,
  ApplePayProvider,
  GooglePayProvider,
} = require('../../../src/payments/payment-gateway');

describe('PaymentGateway', () => {
  describe('initializeProviders', () => {
    test('only registers providers whose config keys are present', () => {
      const gateway = new PaymentGateway({ stripeSecretKey: 'sk_test_123' });
      expect(gateway.providers.has('stripe')).toBe(true);
      expect(gateway.providers.has('ecocash')).toBe(false);
      expect(gateway.providers.has('netone')).toBe(false);
      expect(gateway.providers.has('paynow')).toBe(false);
      expect(gateway.providers.has('apple_pay')).toBe(false);
      expect(gateway.providers.has('google_pay')).toBe(false);
    });

    test('registers a provider for each configured credential set', () => {
      const gateway = new PaymentGateway({
        stripeSecretKey: 'sk_test',
        ecocashMerchantCode: 'ECO123',
        netoneApiKey: 'NETONE_KEY',
        paynowIntegrationId: 'PN123',
        applePayMerchantId: 'merchant.apple',
        googlePayMerchantId: 'merchant.google',
      });

      expect(gateway.providers.get('stripe')).toBeInstanceOf(StripeProvider);
      expect(gateway.providers.get('ecocash')).toBeInstanceOf(EcoCashProvider);
      expect(gateway.providers.get('netone')).toBeInstanceOf(NetOneProvider);
      expect(gateway.providers.get('paynow')).toBeInstanceOf(PayNowProvider);
      expect(gateway.providers.get('apple_pay')).toBeInstanceOf(ApplePayProvider);
      expect(gateway.providers.get('google_pay')).toBeInstanceOf(GooglePayProvider);
    });

    test('with no config and no relevant env vars, no providers are registered', () => {
      const gateway = new PaymentGateway({});
      expect(gateway.providers.size).toBe(0);
    });
  });

  describe('getAvailableMethods', () => {
    let gateway;

    beforeEach(() => {
      gateway = new PaymentGateway({
        stripeSecretKey: 'sk_test',
        ecocashMerchantCode: 'ECO123',
        netoneApiKey: 'NETONE_KEY',
        paynowIntegrationId: 'PN123',
        applePayMerchantId: 'merchant.apple',
        googlePayMerchantId: 'merchant.google',
      });
    });

    test('Zimbabwe + mobile includes local mobile-money methods plus card and Google Pay, but not Apple Pay', () => {
      const methods = gateway.getAvailableMethods({ country: 'ZW', device: 'mobile' });
      const ids = methods.map(m => m.id);
      expect(ids).toEqual(expect.arrayContaining(['ecocash', 'netone', 'paynow', 'stripe', 'google_pay']));
      expect(ids).not.toContain('apple_pay');
    });

    test('Zimbabwe + iOS includes Apple Pay', () => {
      const methods = gateway.getAvailableMethods({ country: 'ZW', device: 'ios' });
      expect(methods.map(m => m.id)).toContain('apple_pay');
    });

    test('non-Zimbabwe country excludes local mobile-money methods', () => {
      const methods = gateway.getAvailableMethods({ country: 'US', device: 'mobile' });
      const ids = methods.map(m => m.id);
      expect(ids).not.toContain('ecocash');
      expect(ids).not.toContain('netone');
      expect(ids).not.toContain('paynow');
      expect(ids).toContain('stripe');
    });

    test('defaults to country ZW and device mobile when options omitted', () => {
      const methods = gateway.getAvailableMethods();
      expect(methods.map(m => m.id)).toEqual(
        expect.arrayContaining(['ecocash', 'netone', 'paynow'])
      );
    });

    test('unconfigured gateway returns no methods', () => {
      const empty = new PaymentGateway({});
      expect(empty.getAvailableMethods({ country: 'ZW' })).toEqual([]);
    });
  });

  describe('createPayment / verifyPayment / refund / handleWebhook', () => {
    let gateway;

    beforeEach(() => {
      gateway = new PaymentGateway({ stripeSecretKey: 'sk_test' });
    });

    test('createPayment rejects an unknown provider', async () => {
      await expect(gateway.createPayment('bogus', {})).rejects.toThrow(
        "Payment provider 'bogus' not available"
      );
    });

    test('verifyPayment rejects an unknown provider', async () => {
      await expect(gateway.verifyPayment('bogus', 'tx_1')).rejects.toThrow(
        "Payment provider 'bogus' not available"
      );
    });

    test('refund rejects an unknown provider', async () => {
      await expect(gateway.refund('bogus', 'tx_1', 5, 'reason')).rejects.toThrow(
        "Payment provider 'bogus' not available"
      );
    });

    test('handleWebhook rejects an unknown provider', async () => {
      await expect(gateway.handleWebhook('bogus', {}, {})).rejects.toThrow(
        "Payment provider 'bogus' not available"
      );
    });

    test('createPayment delegates to the provider and logs the transaction', async () => {
      const stripe = gateway.providers.get('stripe');
      jest.spyOn(stripe, 'createPayment').mockResolvedValue({
        success: true,
        transactionId: 'pi_123',
        status: 'requires_payment_method',
      });
      const logSpy = jest.spyOn(gateway, 'logTransaction').mockResolvedValue();

      const result = await gateway.createPayment('stripe', { amount: 10 });

      expect(result.transactionId).toBe('pi_123');
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'stripe', status: 'requires_payment_method' })
      );
    });

    test('createPayment logs a failed transaction and rethrows when the provider throws', async () => {
      const stripe = gateway.providers.get('stripe');
      jest.spyOn(stripe, 'createPayment').mockRejectedValue(new Error('card declined'));
      const logSpy = jest.spyOn(gateway, 'logTransaction').mockResolvedValue();

      await expect(gateway.createPayment('stripe', { amount: 10 })).rejects.toThrow('card declined');
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'stripe', status: 'failed', error: 'card declined' })
      );
    });

    test('handleWebhook throws when signature verification fails, and never calls processWebhook', async () => {
      const stripe = gateway.providers.get('stripe');
      jest.spyOn(stripe, 'verifyWebhook').mockResolvedValue(false);
      const processSpy = jest.spyOn(stripe, 'processWebhook');

      await expect(gateway.handleWebhook('stripe', {}, {})).rejects.toThrow(
        'Invalid webhook signature'
      );
      expect(processSpy).not.toHaveBeenCalled();
    });

    test('handleWebhook processes the payload once the signature is valid', async () => {
      const stripe = gateway.providers.get('stripe');
      jest.spyOn(stripe, 'verifyWebhook').mockResolvedValue(true);
      jest.spyOn(stripe, 'processWebhook').mockResolvedValue({ type: 'payment_success' });

      const result = await gateway.handleWebhook('stripe', {}, {});
      expect(result).toEqual({ type: 'payment_success' });
    });
  });
});

describe('StripeProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new StripeProvider({ stripeSecretKey: 'sk_test', stripeWebhookSecret: 'whsec_test' });
  });

  test('verifyWebhook returns false when there is no signature header', async () => {
    await expect(provider.verifyWebhook({ a: 1 }, {})).resolves.toBe(false);
  });

  test('verifyWebhook returns false when no webhook secret is configured', async () => {
    const noSecret = new StripeProvider({ stripeSecretKey: 'sk_test' });
    await expect(
      noSecret.verifyWebhook({ a: 1 }, { 'stripe-signature': 'deadbeef' })
    ).resolves.toBe(false);
  });

  test('verifyWebhook accepts a correctly computed HMAC signature', async () => {
    const crypto = require('crypto');
    const payload = { type: 'payment_intent.succeeded' };
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(JSON.stringify(payload), 'utf8')
      .digest('hex');

    await expect(
      provider.verifyWebhook(payload, { 'stripe-signature': signature })
    ).resolves.toBe(true);
  });

  test('verifyWebhook rejects a tampered payload', async () => {
    const crypto = require('crypto');
    const signature = crypto
      .createHmac('sha256', 'whsec_test')
      .update(JSON.stringify({ type: 'payment_intent.succeeded' }), 'utf8')
      .digest('hex');

    await expect(
      provider.verifyWebhook({ type: 'payment_intent.payment_failed' }, { 'stripe-signature': signature })
    ).resolves.toBe(false);
  });

  test.each([
    [
      { type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', amount: 1000, currency: 'usd', metadata: {} } } },
      { type: 'payment_success', transactionId: 'pi_1', amount: 10, currency: 'usd', metadata: {} },
    ],
    [
      { type: 'payment_intent.payment_failed', data: { object: { id: 'pi_2', last_payment_error: { message: 'insufficient funds' } } } },
      { type: 'payment_failed', transactionId: 'pi_2', error: 'insufficient funds' },
    ],
    [
      { type: 'charge.refunded', data: { object: { payment_intent: 'pi_3', amount_refunded: 500 } } },
      { type: 'refund', transactionId: 'pi_3', amount: 5 },
    ],
    [{ type: 'some.other.event' }, { type: 'unknown', event: 'some.other.event' }],
  ])('processWebhook maps %o to the expected normalized event', async (input, expected) => {
    await expect(provider.processWebhook(input)).resolves.toEqual(expected);
  });

  test('createPayment converts amount to cents and normalizes the response', async () => {
    jest.spyOn(provider, 'makeRequest').mockResolvedValue({
      id: 'pi_abc',
      client_secret: 'secret_abc',
      status: 'requires_payment_method',
      amount: 2500,
      currency: 'usd',
    });

    const result = await provider.createPayment({ amount: 25, currency: 'usd', description: 'Voucher' });

    expect(provider.makeRequest).toHaveBeenCalledWith(
      '/payment_intents',
      'POST',
      expect.stringContaining('amount=2500')
    );
    expect(result).toEqual({
      success: true,
      transactionId: 'pi_abc',
      clientSecret: 'secret_abc',
      status: 'requires_payment_method',
      amount: 25,
      currency: 'usd',
      provider: 'stripe',
    });
  });

  test('verifyPayment reports success only when status is succeeded', async () => {
    jest.spyOn(provider, 'makeRequest').mockResolvedValue({
      status: 'succeeded',
      amount: 1000,
      currency: 'usd',
      metadata: { userId: 'u1' },
    });

    const result = await provider.verifyPayment('pi_abc');
    expect(result).toEqual({
      success: true,
      status: 'succeeded',
      amount: 10,
      currency: 'usd',
      metadata: { userId: 'u1' },
    });
  });
});

describe('EcoCashProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new EcoCashProvider({ ecocashMerchantCode: 'M1', ecocashApiKey: 'key1' });
  });

  test.each([
    ['0771234567', '263771234567'],
    ['771234567', '263771234567'],
    ['263771234567', '263771234567'],
    ['+263 77 123 4567', '263771234567'],
  ])('sanitizePhoneNumber normalizes %s to %s', (input, expected) => {
    expect(provider.sanitizePhoneNumber(input)).toBe(expected);
  });

  test('uses the sandbox base URL by default and production when configured', () => {
    expect(provider.baseUrl).toContain('sandbox');
    const prod = new EcoCashProvider({ ecocashEnvironment: 'production' });
    expect(prod.baseUrl).toBe('https://api.ecocash.co.zw/v2');
  });

  test('verifyWebhook returns false without a signature header', async () => {
    await expect(provider.verifyWebhook({}, {})).resolves.toBe(false);
  });

  test('verifyWebhook validates the HMAC signature', async () => {
    const crypto = require('crypto');
    const payload = { transactionRef: 'T1', status: 'SUCCESS' };
    const signature = crypto.createHmac('sha256', 'key1').update(JSON.stringify(payload)).digest('hex');

    await expect(provider.verifyWebhook(payload, { 'x-ecocash-signature': signature })).resolves.toBe(true);
    await expect(provider.verifyWebhook(payload, { 'x-ecocash-signature': 'wrong' })).resolves.toBe(false);
  });

  test('processWebhook maps SUCCESS to payment_success and anything else to payment_failed', async () => {
    await expect(
      provider.processWebhook({ transactionRef: 'T1', status: 'SUCCESS', amount: '5.00', currency: 'USD' })
    ).resolves.toEqual({ type: 'payment_success', transactionId: 'T1', amount: 5, currency: 'USD', status: 'success' });

    await expect(
      provider.processWebhook({ transactionRef: 'T2', status: 'CANCELLED', amount: '5.00', currency: 'USD' })
    ).resolves.toMatchObject({ type: 'payment_failed' });
  });

  test('createPayment sanitizes the phone number and returns a pending result', async () => {
    jest.spyOn(provider, 'makeRequest').mockResolvedValue({ transactionRef: 'ECO-1' });

    const result = await provider.createPayment({
      amount: 5,
      currency: 'USD',
      phoneNumber: '0771234567',
      reference: 'REF1',
    });

    expect(provider.makeRequest).toHaveBeenCalledWith(
      '/payments/initiate',
      'POST',
      expect.objectContaining({ customerPhone: '263771234567' })
    );
    expect(result).toMatchObject({ success: true, transactionId: 'ECO-1', status: 'pending' });
  });
});

describe('NetOneProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new NetOneProvider({ netoneApiKey: 'key1', netoneMerchantId: 'M1' });
  });

  test.each([
    ['0771234567', '263771234567'],
    ['771234567', '771234567'],
  ])('sanitizePhoneNumber(%s) => %s (no forced 263 prefix unlike EcoCash)', (input, expected) => {
    expect(provider.sanitizePhoneNumber(input)).toBe(expected);
  });

  test('verifyWebhook validates the HMAC signature', async () => {
    const crypto = require('crypto');
    const payload = { transactionId: 'T1', status: 'COMPLETED' };
    const signature = crypto.createHmac('sha256', 'key1').update(JSON.stringify(payload)).digest('hex');

    await expect(provider.verifyWebhook(payload, { 'x-netone-signature': signature })).resolves.toBe(true);
    await expect(provider.verifyWebhook(payload, {})).resolves.toBe(false);
  });

  test('processWebhook reflects COMPLETED vs other statuses', async () => {
    await expect(
      provider.processWebhook({ transactionId: 'T1', status: 'COMPLETED', amount: '5', currency: 'USD' })
    ).resolves.toMatchObject({ type: 'payment_success' });

    await expect(
      provider.processWebhook({ transactionId: 'T2', status: 'FAILED', amount: '5', currency: 'USD' })
    ).resolves.toMatchObject({ type: 'payment_failed' });
  });
});

describe('PayNowProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new PayNowProvider({ paynowIntegrationId: 'ID1', paynowIntegrationKey: 'SECRET' });
  });

  test('generateHash is deterministic for the same values and key', () => {
    const values = { id: 'ID1', reference: 'REF1', amount: '5.00' };
    expect(provider.generateHash(values)).toBe(provider.generateHash({ ...values }));
  });

  test('generateHash changes when the integration key changes', () => {
    const values = { id: 'ID1', reference: 'REF1', amount: '5.00' };
    const other = new PayNowProvider({ paynowIntegrationId: 'ID1', paynowIntegrationKey: 'OTHER' });
    expect(provider.generateHash(values)).not.toBe(other.generateHash(values));
  });

  test('verifyWebhook accepts a payload whose hash matches and rejects a tampered one', async () => {
    const payload = { reference: 'REF1', amount: '5.00', status: 'Paid' };
    payload.hash = provider.generateHash(payload);

    await expect(provider.verifyWebhook({ ...payload })).resolves.toBe(true);
    await expect(provider.verifyWebhook({ ...payload, amount: '999.00' })).resolves.toBe(false);
  });

  test('processWebhook reports payment_success only for status "Paid"', async () => {
    await expect(
      provider.processWebhook({ status: 'Paid', reference: 'REF1', amount: '5.00', paynowreference: 'PN1' })
    ).resolves.toMatchObject({ type: 'payment_success' });

    await expect(
      provider.processWebhook({ status: 'Created', reference: 'REF1', amount: '5.00' })
    ).resolves.toMatchObject({ type: 'payment_update' });
  });

  test('createPayment parses a successful "OK|redirect|poll" response', async () => {
    jest.spyOn(provider, 'makeRequest').mockResolvedValue('OK|https://paynow/redirect|https://paynow/poll');

    const result = await provider.createPayment({ amount: 5, reference: 'REF1' });

    expect(result).toMatchObject({
      success: true,
      transactionId: 'REF1',
      redirectUrl: 'https://paynow/redirect',
      pollUrl: 'https://paynow/poll',
    });
  });

  test('createPayment throws when PayNow responds with an error status', async () => {
    jest.spyOn(provider, 'makeRequest').mockResolvedValue('Error|Invalid reference');

    await expect(provider.createPayment({ amount: 5, reference: 'REF1' })).rejects.toThrow('PayNow error');
  });

  test('refund always rejects — PayNow has no refund API', async () => {
    await expect(provider.refund('REF1', 5, 'reason')).rejects.toThrow(
      'PayNow refunds must be processed through the merchant dashboard'
    );
  });
});

describe('ApplePayProvider / GooglePayProvider (no live network calls)', () => {
  test('ApplePayProvider.createPayment returns a session config without hitting the network', async () => {
    const provider = new ApplePayProvider({ applePayMerchantId: 'merchant.test', applePayMerchantDomain: 'br3eze.africa' });
    const result = await provider.createPayment({ amount: 5, currency: 'USD' });
    expect(result).toMatchObject({ success: true, type: 'apple_pay_session', merchantIdentifier: 'merchant.test' });
  });

  test('ApplePayProvider.refund always rejects', async () => {
    const provider = new ApplePayProvider({});
    await expect(provider.refund('tx', 5, 'reason')).rejects.toThrow(
      'Process Apple Pay refunds through your payment processor'
    );
  });

  test('GooglePayProvider.createPayment returns client config without hitting the network', async () => {
    const provider = new GooglePayProvider({ googlePayMerchantId: 'merchant.test' });
    const result = await provider.createPayment({ amount: 5, currency: 'USD' });
    expect(result).toMatchObject({ success: true, type: 'google_pay_config' });
  });

  test('GooglePayProvider.refund always rejects', async () => {
    const provider = new GooglePayProvider({});
    await expect(provider.refund('tx', 5, 'reason')).rejects.toThrow(
      'Process Google Pay refunds through your payment processor'
    );
  });
});
