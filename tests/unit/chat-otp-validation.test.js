import { describe, expect, test, jest } from '@jest/globals';
import {
  normalizeEmail,
  isValidEmail,
  normalizePhone,
  isValidOtpCode,
  isValidGraphApiVersion
} from '../../api/chat/otp/validation.js';
import { registerPhoneVerificationRoutes } from '../../api/chat/otp/phone/routes.js';
import { registerOtpRoutes } from '../../api/chat/otp/register.js';
import { sendWhatsAppOtp } from '../../api/chat/otp/providers/whatsapp.js';

describe('OTP input validation', () => {
  test('normalizes email and rejects whitespace and malformed addresses', () => {
    expect(normalizeEmail('  Brighton@Example.COM  ')).toBe('brighton@example.com');
    expect(isValidEmail('brighton@example.com')).toBe(true);
    expect(isValidEmail('brighton example.com')).toBe(false);
    expect(isValidEmail('brighton@invalid')).toBe(false);
  });

  test('normalizes Zimbabwean local and international phone numbers to E.164', () => {
    expect(normalizePhone('077 123 4567')).toBe('+263771234567');
    expect(normalizePhone('263771234567')).toBe('+263771234567');
    expect(normalizePhone('+447700900123')).toBe('+447700900123');
    expect(() => normalizePhone('123')).toThrow();
  });

  test('accepts exactly six numeric OTP digits', () => {
    expect(isValidOtpCode('004201')).toBe(true);
    expect(isValidOtpCode('12345')).toBe(false);
    expect(isValidOtpCode('1234567')).toBe(false);
    expect(isValidOtpCode('12a456')).toBe(false);
  });

  test('validates versioned Meta Graph API version strings', () => {
    expect(isValidGraphApiVersion('v26.0')).toBe(true);
    expect(isValidGraphApiVersion('v25.0')).toBe(true);
    expect(isValidGraphApiVersion('26.0')).toBe(false);
    expect(isValidGraphApiVersion('v26')).toBe(false);
  });
});


describe('WhatsApp phone OTP route registration', () => {
  test('registers canonical routes and preserves the legacy aliases', () => {
    const paths = [];
    const app = { post: (path) => paths.push(path) };
    const authMiddleware = (_req, _res, next) => next();

    registerPhoneVerificationRoutes({ app, authMiddleware });

    expect(paths).toEqual([
      '/api/chat/otp/whatsapp/request',
      '/api/chat/otp/whatsapp/verify',
      '/api/auth/otp/whatsapp/request',
      '/api/auth/otp/whatsapp/verify'
    ]);
  });
});


describe('OTP API composition', () => {
  test('mounts canonical email OTP, compatibility alias and authenticated WhatsApp routes', () => {
    const mounts = [];
    const paths = [];
    const app = {
      use: (path) => mounts.push(path),
      post: (path) => paths.push(path)
    };

    registerOtpRoutes({
      app,
      emailRouter: {},
      authMiddleware: (_req, _res, next) => next()
    });

    expect(mounts).toEqual(['/api/chat/otp', '/api/auth/otp']);
    expect(paths).toContain('/api/chat/otp/whatsapp/request');
    expect(paths).toContain('/api/chat/otp/whatsapp/verify');
  });
});


describe('WhatsApp Cloud API provider', () => {
  test('sends a normalized recipient and OTP using the approved authentication template', async () => {
    const originalFetch = global.fetch;
    const keys = [
      'WHATSAPP_GRAPH_API_VERSION',
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_OTP_TEMPLATE_NAME',
      'WHATSAPP_OTP_TEMPLATE_LANGUAGE'
    ];
    const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

    process.env.WHATSAPP_GRAPH_API_VERSION = 'v26.0';
    process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-token';
    process.env.WHATSAPP_OTP_TEMPLATE_NAME = 'br3eze_auth_code';
    process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE = 'en';

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.test' }] })
    });
    global.fetch = fetchMock;

    try {
      await expect(sendWhatsAppOtp({ to: '077 123 4567', code: '004201' }))
        .resolves.toEqual({ messageId: 'wamid.test' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/v26.0/1234567890/messages');
      expect(options.method).toBe('POST');
      const payload = JSON.parse(options.body);
      expect(payload.to).toBe('263771234567');
      expect(payload.template.components[0].parameters[0].text).toBe('004201');
      expect(payload.template.components[1].sub_type).toBe('url');
    } finally {
      global.fetch = originalFetch;
      for (const key of keys) {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
      }
    }
  });
});
