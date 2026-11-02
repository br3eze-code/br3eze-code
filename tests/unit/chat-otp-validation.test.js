import { describe, expect, test } from '@jest/globals';
import {
  normalizeEmail,
  isValidEmail,
  normalizePhone,
  isValidOtpCode,
  isValidGraphApiVersion
} from '../../api/chat/otp/validation.js';
import { registerPhoneVerificationRoutes } from '../../api/chat/otp/phone/routes.js';

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
