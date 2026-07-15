import { jest } from '@jest/globals';
import MikroTikDomain from '../../../src/domains/mikrotik/index.js';

describe('MikroTikDomain', () => {
  let domain;

  beforeEach(() => {
    domain = new MikroTikDomain({});
  });

  test('registers getStats, getArp, reboot tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['getArp', 'getStats', 'reboot']);
  });

  test('getStats() delegates to the underlying MikroTikManager.getSystemStats()', async () => {
    jest.spyOn(domain.client, 'getSystemStats').mockResolvedValue({ cpuLoad: 12 });
    const result = await domain.execute({ tool: 'getStats', params: undefined });
    expect(result).toEqual({ cpuLoad: 12 });
  });

  test('getArp() delegates to the underlying MikroTikManager.getArpTable()', async () => {
    jest.spyOn(domain.client, 'getArpTable').mockResolvedValue([{ ip: '10.0.0.5' }]);
    const result = await domain.execute({ tool: 'getArp', params: undefined });
    expect(result).toEqual([{ ip: '10.0.0.5' }]);
  });

  test('reboot() delegates to the underlying MikroTikManager.reboot()', async () => {
    jest.spyOn(domain.client, 'reboot').mockResolvedValue({ success: true });
    const result = await domain.execute({ tool: 'reboot', params: undefined });
    expect(result).toEqual({ success: true });
  });

  test('a manager-level failure propagates instead of being silently swallowed', async () => {
    jest.spyOn(domain.client, 'getSystemStats').mockRejectedValue(new Error('router unreachable'));
    await expect(domain.execute({ tool: 'getStats', params: undefined })).rejects.toThrow(
      'router unreachable'
    );
  });
});
