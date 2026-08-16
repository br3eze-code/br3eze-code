import {
  calculateCommission,
  canViewContractorWork,
  normalizeContractorWork,
  summarizeContractorWork,
} from '../../src/core/contractor-work-queue.js';
import { buildActionManifest } from '../../src/core/channel-action-manifest.js';

describe('contractor work queue', () => {
  const scope = {
    tenantId: 'tenant-a',
    userId: 'agent-a',
    projectId: 'project-a',
    siteId: 'site-a',
    domain: 'general',
  };

  test('normalizes scoped work and rejects unsupported roles', () => {
    expect(
      normalizeContractorWork({ agentRole: 'engineer', title: 'Inspect system' }, scope)
    ).toMatchObject({
      contractorRole: 'engineer',
      tenantId: 'tenant-a',
      projectId: 'project-a',
      status: 'proposed',
    });
    expect(() => normalizeContractorWork({ agentRole: 'hacker' }, scope)).toThrow(
      'Unsupported contractor role'
    );
  });

  test('commission remains pending until verified evidence exists', () => {
    expect(
      calculateCommission({
        approvedValue: 1000,
        commissionRate: 0.1,
        status: 'submitted',
        evidenceRefs: [],
      })
    ).toMatchObject({ amount: 100, state: 'pending_verification' });
    expect(
      calculateCommission({
        approvedValue: 1000,
        commissionRate: 0.1,
        status: 'verified',
        evidenceRefs: ['evidence-1'],
      })
    ).toMatchObject({ amount: 100, state: 'payable' });
  });

  test('tier visibility keeps standard users from seeing pro-only work', () => {
    const work = normalizeContractorWork(
      { agentRole: 'designer', tierVisibility: 'pro', ownerUserId: 'agent-a' },
      scope
    );
    expect(
      canViewContractorWork({
        viewerTier: 'standard',
        viewerRole: 'user',
        work,
        viewerUserId: 'user-a',
      })
    ).toBe(false);
    expect(
      canViewContractorWork({ viewerTier: 'pro', viewerRole: 'user', work, viewerUserId: 'user-a' })
    ).toBe(true);
    expect(
      canViewContractorWork({
        viewerTier: 'standard',
        viewerRole: 'user',
        work,
        viewerUserId: 'agent-a',
      })
    ).toBe(true);
  });

  test('summary counts only visible work and commission', () => {
    const items = [
      normalizeContractorWork(
        {
          agentRole: 'planner',
          status: 'verified',
          evidenceRefs: ['e1'],
          approvedValue: 500,
          commissionRate: 0.1,
        },
        scope
      ),
      normalizeContractorWork(
        {
          agentRole: 'engineer',
          tierVisibility: 'pro',
          status: 'submitted',
          approvedValue: 900,
          commissionRate: 0.2,
        },
        { ...scope, userId: 'agent-b' }
      ),
    ];
    expect(
      summarizeContractorWork(items, {
        viewerTier: 'standard',
        viewerRole: 'user',
        viewerUserId: 'user-a',
      })
    ).toMatchObject({ visibleCount: 1, verifiedCount: 1, commissionPending: 50 });
  });

  test('channel manifest exposes tier-appropriate team actions', () => {
    const standard = buildActionManifest({ role: 'user', influenceTier: 'standard' }).map(
      item => item.action
    );
    const partner = buildActionManifest({ role: 'user', influenceTier: 'partner' }).map(
      item => item.action
    );
    const admin = buildActionManifest({ role: 'admin', influenceTier: 'admin' }).map(
      item => item.action
    );
    expect(standard).not.toContain('team.progress');
    expect(partner).toContain('team.progress');
    expect(admin).toContain('team.commission.approve');
  });
});
