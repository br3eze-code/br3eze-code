import { jest } from '@jest/globals';
import { githubDeviceFlowLogin } from '../../src/core/oauth2.js';
import { buildServiceCommand, detectionCommand } from '../../src/core/platform/service-manager.js';

describe('OAuth 2.0 and service-manager adapters', () => {
  test('GitHub device flow returns an authenticated profile', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        device_code: 'device',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        verification_uri_complete: 'https://github.com/login/device?user_code=ABCD-EFGH',
        expires_in: 60,
        interval: 0,
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token', scope: 'read:user' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ login: 'br3eze-code', name: 'Br3eze Code' }) });
    const prompt = jest.fn();
    const openBrowser = jest.fn();
    const identity = await githubDeviceFlowLogin({ clientId: 'client', fetchImpl, onPrompt: prompt, openBrowser });
    expect(identity.login).toBe('br3eze-code');
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'ABCD-EFGH' }));
    expect(openBrowser).toHaveBeenCalledWith(expect.stringContaining('user_code=ABCD-EFGH'));
  });

  test('service commands are portable and quote unsafe names', () => {
    expect(detectionCommand('linux')).toContain('systemd');
    expect(buildServiceCommand('status', 'systemd', 'nginx.service')).toContain('systemctl show');
    expect(buildServiceCommand('restart', 'openrc', 'nginx')).toContain('rc-service');
    expect(buildServiceCommand('status', 'sysvinit', 'cron')).toContain('service');
    expect(() => buildServiceCommand('restart', 'systemd', 'nginx; reboot')).toThrow('Invalid service name');
  });
});
