import { jest } from '@jest/globals';
import { anyCapabilityMatches } from '../../src/core/capability-policy.js';
import { UserSandbox } from '../../src/core/userSandbox.js';

describe('provider-neutral capability policy', () => {
  test('maps generic capabilities to provider adapters', () => {
    expect(anyCapabilityMatches(['network.read'], 'mikrotik.system.stats')).toBe(true);
    expect(anyCapabilityMatches(['network.write'], 'mikrotik.user.kick')).toBe(true);
    expect(anyCapabilityMatches(['surveillance.read'], 'dahua.snapshot.get')).toBe(true);
    expect(anyCapabilityMatches(['fleet.read'], 'starlink.terminal.status')).toBe(true);
    expect(anyCapabilityMatches(['commerce.read'], 'shop.list_products')).toBe(true);
  });

  test('UserSandbox authorizes generic policy entries and retains approval checks', async () => {
    const sandbox = new UserSandbox({ db: { getUser: async () => ({ role: 'operator' }) } });
    expect(await sandbox.canUse('user-1', 'mikrotik.user.kick')).toBe(true);
    expect(await sandbox.canUse('user-1', 'dahua.snapshot.get')).toBe(true);
    expect(await sandbox.needsApproval('user-1', 'mikrotik.firewall.drop')).toBe(true);
  });
});
