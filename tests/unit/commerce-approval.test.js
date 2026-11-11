import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import { approvalOrProposal } from '../../src/runtime/skills/commerce-helpers.js';
import { createMikrotikSkill } from '../../src/runtime/skills/mikrotik.js';

test('approval does not authorize a different payload', () => {
  const context = {
    tenantId: 'tenant-1',
    approval: {
      granted: true,
      action: 'billing.refund',
      tenantId: 'tenant-1',
      args: { amountMinor: 100 },
    },
  };
  const blocked = approvalOrProposal('billing.refund', { amountMinor: 500 }, context, { risk: 'critical' });
  assert.equal(blocked.status, 'approval_required');
  const allowed = approvalOrProposal('billing.refund', { amountMinor: 100 }, context, { risk: 'critical' });
  assert.equal(allowed, null);
});

test('approval without a bound payload stays blocked', () => {
  const result = approvalOrProposal('billing.capture', { amountMinor: 100 }, {
    tenantId: 'tenant-1',
    approval: { granted: true, action: 'billing.capture', tenantId: 'tenant-1' },
  });
  assert.equal(result.approvalRequired, true);
});

test('mikrotik text match cannot select a disconnect', () => {
  const skill = createMikrotikSkill({
    getActiveUsers: async () => [],
    getSystemStats: async () => ({}),
    kickUser: async () => ({ kicked: true }),
  });
  assert.equal(skill.match('kick user alice'), null);
  assert.deepEqual(skill.match('who'), { tool: 'network.who', args: {} });
  const kick = skill.tools.find((tool) => tool.name === 'network.kick');
  assert.equal(kick.risk, 'high');
  assert.deepEqual(kick.permissions, ['network:disconnect']);
  assert.deepEqual(kick.parameters.required, ['username']);
});
