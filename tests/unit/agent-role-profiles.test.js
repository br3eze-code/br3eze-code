import {
  PROFILE_DEFINITIONS,
  normalizeAgentRole,
  getAgentRoleProfile,
  isApprovalRequired
} from '../../src/core/agent-role-profiles.js';
import { buildExecutionContext } from '../../src/core/execution-context.js';
import { instantiateWorkPackages, getWorkPackageRoles, validateWorkPackage } from '../../src/core/wbs-work-packages.js';

describe('professional agent role profiles', () => {
  const roles = ['planner', 'engineer', 'accountant', 'secretary', 'procurement', 'expeditor', 'designer', 'draftsman'];

  test.each(roles)('%s has a domain-neutral profile and safe defaults', (role) => {
    const profile = getAgentRoleProfile(role);
    expect(profile).toBeTruthy();
    expect(profile.domains).toContain('*');
    expect(profile.capabilities.length).toBeGreaterThan(0);
    expect(profile.defaultNextAction).toBeTruthy();
  });

  test('normalizes professional aliases without changing canonical roles', () => {
    expect(normalizeAgentRole('purchasing')).toBe('procurement');
    expect(normalizeAgentRole('drafter')).toBe('draftsman');
    expect(normalizeAgentRole('unknown-role')).toBeNull();
  });

  test('keeps financial and technical mutations approval-gated', () => {
    expect(isApprovalRequired('accountant', 'payment.create')).toBe(true);
    expect(isApprovalRequired('engineer', 'config.write')).toBe(true);
    expect(isApprovalRequired('secretary', 'message.send')).toBe(true);
    expect(isApprovalRequired('planner', 'context.read')).toBe(false);
  });

  test('propagates the role profile through canonical execution context', () => {
    const context = buildExecutionContext({
      userId: 'user-1',
      tenantId: 'tenant-1',
      siteId: 'site-1',
      domain: 'general',
      agentRole: 'procurement',
      channel: 'web'
    });
    expect(context.agentRole).toBe('procurement');
    expect(context.agentProfile.role).toBe('procurement');
    expect(context.tenantId).toBe('tenant-1');
    expect(context.siteId).toBe('site-1');
  });

  test('provides WBS packages for every professional role', () => {
    expect(getWorkPackageRoles()).toEqual(expect.arrayContaining([...roles, 'qa']));
    for (const role of [...roles, 'qa']) {
      const packages = instantiateWorkPackages(role, { userId: 'u1', tenantId: 't1', siteId: 's1', domain: 'general' });
      expect(packages.length).toBeGreaterThan(0);
      expect(packages[0]).toMatchObject({ agentRole: role, tenantId: 't1', siteId: 's1', status: 'ready' });
      expect(packages.every((item) => validateWorkPackage(item).valid)).toBe(true);
    }
  });

  test('does not expose mutable profile references', () => {
    const first = getAgentRoleProfile('designer');
    first.capabilities.push('unsafe.write');
    expect(PROFILE_DEFINITIONS.designer.capabilities).not.toContain('unsafe.write');
  });
});
