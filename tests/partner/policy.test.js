import { describe, expect, test } from '@jest/globals';
import { PartnerPolicy } from '../../services/partner/policy.mjs';

describe('partner release policy', () => {
  const policy = new PartnerPolicy({ releaseThreshold: 0.9 });

  test('AI cannot release funds even after a passing recommendation', () => {
    expect(policy.canRelease({
      actor: { type: 'ai' },
      job: { status: 'human_review' },
      verification: { decision: 'approve' },
    })).toBe(false);
  });

  test('human can release an approved verification', () => {
    expect(policy.canRelease({
      actor: { type: 'human', id: 'reviewer-1' },
      job: { status: 'human_review' },
      verification: { decision: 'approve' },
    })).toBe(true);
  });
});
