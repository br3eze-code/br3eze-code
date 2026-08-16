import {
  assertAgentosScope,
  validateAgentosA2AMessage,
  validateRestockTransition,
  publishRestockTransition,
} from '../../src/core/a2a-agentos-policy.js';

describe('AgentOS A2A CPO/CFO policy', () => {
  const base = {
    protocol: 'A2A',
    sender: 'spiffe://agent/cpo-1',
    recipient: 'spiffe://agent/cfo-1',
    task: {
      taskId: 'task-1',
      capability: 'purchase.cost.review',
      agentos: {
        fromRole: 'cpo',
        toRole: 'cfo',
        wbsId: 'WP-PRO-004',
        handoffId: 'handoff-1',
        traceId: 'trace-1',
        scope: {
          tenantId: 'tenant-a',
          userId: 'user-a',
          projectId: 'project-a',
          domain: 'commerce',
          siteId: 'site-a',
        },
      },
    },
    traceId: 'trace-1',
  };

  test('accepts a correctly scoped CPO to CFO message', () => {
    expect(validateAgentosA2AMessage(base).valid).toBe(true);
  });

  test('rejects a cross-tenant message', () => {
    const result = validateAgentosA2AMessage(base, { expectedScope: { tenantId: 'tenant-b' } });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('scope.tenantId');
  });

  test('requires approval for purchase commitment', () => {
    const message = structuredClone(base);
    message.task.capability = 'purchase.commit';
    expect(validateAgentosA2AMessage(message).errors).toContain('approval_required');
    message.task.agentos.approval = { approvalId: 'approval-1' };
    expect(validateAgentosA2AMessage(message).valid).toBe(false);
    expect(validateAgentosA2AMessage(message).errors).toContain('capability_not_allowed_for_cell');
  });

  test('rejects incomplete scope', () => {
    expect(() => assertAgentosScope({ tenantId: 'tenant-a' })).toThrow('Missing AgentOS scope');
  });

  test('requires CPO availability evidence before technical review', () => {
    const result = validateRestockTransition({
      proposal: { state: 'catalog_verified' },
      nextState: 'availability_verified',
      actor: { role: 'procurement' },
      evidence: { availabilitySource: 'sql' },
    });
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('availableQuantity');
  });

  test('requires approval before commit', () => {
    const result = validateRestockTransition({
      proposal: { state: 'qa_review' },
      nextState: 'committed',
      actor: { role: 'procurement' },
      evidence: { purchaseOrderId: 'po-1' },
    });
    expect(result.code).toBe('PURCHASE_APPROVAL_REQUIRED');
  });

  test('publishes a scoped restock transition event', () => {
    const event = publishRestockTransition({
      tenantId: 'tenant-a',
      projectId: 'project-a',
      wbsId: 'WP-PRO-004',
      from: 'qa_review',
      to: 'budget_approved',
    });
    expect(event.eventType).toBe('restock.transitioned');
    expect(event.tenantId).toBe('tenant-a');
  });
});
