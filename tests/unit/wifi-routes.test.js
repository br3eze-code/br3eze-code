import { describe, expect, test, jest } from '@jest/globals';
import { registerWifiRoutes } from '../../server/src/domains/wifi/registerRoutes.js';

describe('Wi-Fi route composition', () => {
  test('registers product routes from injected dependencies without booting infrastructure', () => {
    const routes = [];
    const app = {
      get: jest.fn((path, ...handlers) => routes.push({ method: 'GET', path, handlers })),
      post: jest.fn((path, ...handlers) => routes.push({ method: 'POST', path, handlers })),
      use: jest.fn((...args) => routes.push({ method: 'USE', path: args[0] }))
    };
    const database = {
      validateUser: jest.fn(), listVouchers: jest.fn(), createVoucher: jest.fn(),
      redeemVoucher: jest.fn(), getVoucherStats: jest.fn(), getAuditLog: jest.fn()
    };
    const config = {
      GATEWAY_TOKEN: 'test-token',
      RATE_LIMIT: { WINDOW: 1000, MAX: 10 },
      VOUCHER_PLANS: { trial: { duration: 1000, price: 0 } },
      VOUCHER_PREFIX: 'TEST-'
    };

    registerWifiRoutes({
      app,
      otpRouter: {},
      database,
      CONFIG: config,
      BRAND: { name: 'Test', version: '1' },
      authMiddleware: (_req, _res, next) => next(),
      rateLimitMiddleware: (_req, _res, next) => next(),
      getCommandHandler: () => ({ execute: jest.fn(), getAvailableTools: jest.fn() })
    });

    expect(routes.some((route) => route.path === '/health')).toBe(true);
    expect(routes.some((route) => route.path === '/api/vouchers')).toBe(true);
    expect(routes.some((route) => route.path === '/api/v1/vouchers')).toBe(true);
    expect(routes.some((route) => route.path === '/api/v1/vouchers/redeem')).toBe(true);
    expect(routes.some((route) => route.path === '/api/v1/tools')).toBe(true);
    expect(routes.some((route) => route.path === '/api/v1/capabilities')).toBe(true);
    expect(routes.some((route) => route.path === '/api/payment/methods')).toBe(true);
    expect(routes.some((route) => route.path === '/billing/methods')).toBe(true);
    expect(routes.some((route) => route.path === '/api/channels')).toBe(true);
    expect(routes.some((route) => route.path === '/channels/capabilities')).toBe(true);
    expect(routes.some((route) => route.path === '/tool/execute')).toBe(true);
    expect(routes.some((route) => route.path === '/api/auth/otp')).toBe(true);
    expect(app.post).toHaveBeenCalled();
  });

  test('requires explicit dependencies', () => {
    expect(() => registerWifiRoutes({})).toThrow(TypeError);
  });
});
