import { createSystemPort } from '../../src/core/ports/system.js';

describe('provider-neutral system port', () => {
  test('authorizes and approves a targeted reboot before delegating to its adapter', async () => {
    const calls = [];
    const port = createSystemPort({
      authorize: async (request) => { calls.push(['authorize', request.target]); return true; },
      requestApproval: async (request) => { calls.push(['approve', request.target]); return true; },
      resolveTargetAdapter: async (target) => {
        calls.push(['resolve', target]);
        return {
          id: 'test-os-adapter',
          reboot: async (request) => {
            calls.push(['reboot', request.target, request.mode]);
            return { accepted: true };
          },
        };
      },
    });

    const result = await port.reboot({
      target: 'server-01',
      reason: 'Approved maintenance',
      context: { tenantId: 'tenant-a', userId: 'operator-1', requestId: 'req-1' },
    });

    expect(calls).toEqual([
      ['authorize', 'server-01'],
      ['approve', 'server-01'],
      ['resolve', 'server-01'],
      ['reboot', 'server-01', 'graceful'],
    ]);
    expect(result).toMatchObject({
      capability: 'system.reboot',
      target: 'server-01',
      status: 'requested',
      adapter: 'test-os-adapter',
      result: { accepted: true },
    });
  });

  test('fails closed when authorization is denied', async () => {
    const resolveTargetAdapter = jest.fn();
    const port = createSystemPort({
      authorize: async () => false,
      requestApproval: async () => true,
      resolveTargetAdapter,
    });

    await expect(port.reboot({
      target: 'router-01',
      reason: 'Maintenance',
      context: { tenantId: 'tenant-a', userId: 'operator-1' },
    })).rejects.toThrow('SYSTEM_REBOOT_FORBIDDEN');
    expect(resolveTargetAdapter).not.toHaveBeenCalled();
  });

  test.each([
    [{ reason: 'Maintenance' }, 'SYSTEM_REBOOT_TARGET_REQUIRED'],
    [{ target: 'server-01' }, 'SYSTEM_REBOOT_REASON_REQUIRED'],
    [{ target: 'server-01', reason: 'Maintenance', mode: 'unknown' }, 'SYSTEM_REBOOT_MODE_INVALID'],
  ])('validates reboot input before adapter execution', async (input, error) => {
    const port = createSystemPort({
      authorize: async () => true,
      requestApproval: async () => true,
      resolveTargetAdapter: async () => ({ reboot: jest.fn() }),
    });

    await expect(port.reboot({
      ...input,
      context: { tenantId: 'tenant-a', userId: 'operator-1' },
    })).rejects.toThrow(error);
  });

  test('requires explicit tenant and user identity', async () => {
    const port = createSystemPort({
      authorize: async () => true,
      requestApproval: async () => true,
      resolveTargetAdapter: async () => ({ reboot: jest.fn() }),
    });

    await expect(port.reboot({
      target: 'pc-01',
      reason: 'Maintenance',
      context: {},
    })).rejects.toThrow('SYSTEM_REBOOT_IDENTITY_REQUIRED');
  });
});
