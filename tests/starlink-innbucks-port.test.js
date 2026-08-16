import { jest } from '@jest/globals';
import { StarlinkAdapter } from '../src/services/starlink/starlink-adapter.mjs';
import { TieredAccessControl, PERMISSIONS, ROLES } from '../src/services/admin/tiered-access.mjs';
import { InnbucksAdapter } from '../src/services/payments/innbucks.mjs';

describe('Starlink fleet port', () => {
  test('maps fleet and terminal operations to provider endpoints', async () => {
    const calls = [];
    const transport = async (url, options) => {
      calls.push({ url: String(url), options });
      const path = new URL(url).pathname;
      const data = path === '/oauth/token' ? { access_token: 'token', expires_in: 3600 }
        : path === '/fleet/stats' ? { total: 2, online: 1, degraded: 1 }
          : path.endsWith('/telemetry') ? { latency: 20, signalQuality: 90 } : { status: 'ok' };
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    };
    const adapter = new StarlinkAdapter({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://starlink.test', transport });
    await expect(adapter.getFleetStats()).resolves.toMatchObject({ total: 2, online: 1 });
    await expect(adapter.getTelemetry('term-1')).resolves.toMatchObject({ latency: 20 });
    expect(calls.some(({ url }) => url.endsWith('/fleet/stats'))).toBe(true);
    expect(calls.some(({ url }) => url.endsWith('/terminals/term-1/telemetry'))).toBe(true);
  });
});

describe('Tiered access fleet permissions', () => {
  test('scopes regional terminals and grants platform fleet access', async () => {
    const rbac = new TieredAccessControl();
    rbac.assign('regional', { role: ROLES.REGIONAL_ADMIN, terminals: ['a'] });
    rbac.assign('platform', { role: ROLES.PLATFORM_ADMIN });
    expect(await rbac.getAccessibleTerminals('regional', [{ id: 'a' }, { id: 'b' }])).toEqual([{ id: 'a' }]);
    expect(rbac.can('regional', PERMISSIONS.TERMINAL_REBOOT, { terminalId: 'a' })).toBe(true);
    expect(rbac.can('regional', PERMISSIONS.TERMINAL_REBOOT, { terminalId: 'b' })).toBe(false);
    expect(rbac.can('platform', PERMISSIONS.TERMINAL_STOW, { terminalId: 'b' })).toBe(true);
  });
});

describe('Innbucks compatibility adapter', () => {
  test('delegates Paynow initiation and status to the existing gateway', async () => {
    const gateway = { createPayment: jest.fn().mockResolvedValue({ redirectUrl: 'https://pay.test/1', pollUrl: 'https://pay.test/poll', status: 'pending' }), verifyPayment: jest.fn().mockResolvedValue({ status: 'paid' }) };
    const adapter = new InnbucksAdapter({ gateway });
    await expect(adapter.initiatePaynow({ amount: 10, reference: 'AGT-1' })).resolves.toMatchObject({ status: 'pending' });
    await expect(adapter.checkStatus('https://pay.test/poll')).resolves.toEqual({ status: 'paid' });
    expect(gateway.createPayment).toHaveBeenCalledWith('paynow', expect.objectContaining({ amount: 10, reference: 'AGT-1' }));
  });
});
