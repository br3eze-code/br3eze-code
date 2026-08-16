import {
  createNextActionProposal,
  generateNextActionCandidates,
  validateNextActionProposal,
} from '../../src/core/next-action-planner.js';
import { evaluateProactiveNotification, recordProactiveDecision } from '../../src/core/proactive-policy.js';
import { NextActionModelRouter } from '../../src/core/next-action-model-router.js';
import { sanitizeWebMcpObservation, validateWebMcpRequest, webMcpActionManifest } from '../../src/core/web-mcp-policy.js';
import { buildProposalManifest } from '../../src/core/channel-action-manifest.js';
import { TaskRegistry } from '../../src/core/taskRegistry.js';
import { ProactiveTelemetry } from '../../src/core/proactive-telemetry.js';

describe('next-action system', () => {
  const context = {
    userId: 'u1', tenantId: 't1', domainId: 'd1', siteId: 's1', role: 'operator',
    authorizedCapabilities: ['network.read'], locationPermission: false,
  };
  const task = {
    taskId: 'task-1', action: 'assist.task', status: 'running',
    wbs: [{ id: 'assist.task:execute', key: 'execute', title: 'Execute', status: 'running' }],
  };

  test('ranks a WBS-aware continue proposal with evidence and expiry', () => {
    const proposal = createNextActionProposal({ task, context, now: 1700000000000 });
    expect(proposal.valid).toBe(true);
    expect(proposal.candidates[0].actionId).toBe('assist.continue');
    expect(proposal.candidates[0].evidence).toContain('wbs:assist.task:execute:running');
    expect(proposal.candidates[0].expiresAt).toBeTruthy();
  });

  test('requires clarification when trusted scope is incomplete', () => {
    const [candidate] = generateNextActionCandidates({ context: { userId: 'u1' } });
    expect(candidate.actionId).toBe('assist.clarify');
    expect(candidate.reasonCodes).toContain('missing_scope');
  });

  test('does not allow an invented or expired proposal', () => {
    const invalid = validateNextActionProposal({
      valid: true,
      expiresAt: new Date(1000).toISOString(),
      candidates: [{ actionId: 'system.delete_everything', confidence: 1 }],
    }, { context, now: 2000 });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual(expect.arrayContaining(['action_not_legal', 'proposal_expired']));
  });

  test('suppresses proactive messages during opt-out, quiet hours, and budget exhaustion', () => {
    const proposal = createNextActionProposal({ task, context, now: Date.UTC(2026, 0, 1, 12) });
    expect(evaluateProactiveNotification({ proposal, context: { ...context, proactiveOptOut: true }, now: Date.UTC(2026, 0, 1, 12) }).reason).toBe('user_opted_out');
    expect(evaluateProactiveNotification({ proposal, context, now: Date.UTC(2026, 0, 1, 23) }).reason).toBe('quiet_hours');
    expect(evaluateProactiveNotification({ proposal, context, history: [1, 2, 3].map((_, i) => ({ createdAt: new Date(Date.UTC(2026, 0, 1, 12, i)).toISOString() })), now: Date.UTC(2026, 0, 1, 12) }).reason).toBe('notification_budget_exhausted');
  });

  test('records only explicit user decisions', () => {
    expect(recordProactiveDecision({ proposalId: 'p1', decision: 'snooze', userId: 'u1' }).decision).toBe('snooze');
    expect(() => recordProactiveDecision({ proposalId: 'p1', decision: 'execute' })).toThrow('Unsupported proactive decision');
  });

  test('falls back to deterministic planning when an injected model fails', async () => {
    const router = new NextActionModelRouter({ providers: { qwen: { rankCandidates: async () => { throw new Error('offline'); } } }, defaultProvider: 'qwen', policy: { minConfidenceForEscalation: 0.99 } });
    const proposal = await router.propose({ task: { ...task, wbs: [{ id: 'x', key: 'unknown', title: 'Unknown', status: 'pending' }] }, context });
    expect(proposal.source).toBe('deterministic:fallback');
    expect(proposal.candidates.length).toBeGreaterThan(0);
  });

  test('blocks unsafe web-MCP targets and mutating requests without approval', () => {
    expect(validateWebMcpRequest({ url: 'http://127.0.0.1:8080/admin' }).errors).toEqual(expect.arrayContaining(['insecure_protocol', 'private_network_blocked']));
    expect(validateWebMcpRequest({ url: 'https://example.com/update', method: 'POST', allowedHosts: ['example.com'] }).errors).toContain('explicit_approval_required');
    expect(validateWebMcpRequest({ url: 'https://example.com/update', method: 'POST', allowedHosts: ['example.com'], approval: { approved: true } }).allowed).toBe(true);
  });

  test('refreshes proposals with trusted planning context when WBS advances', () => {
    const registry = new TaskRegistry();
    const created = registry.create('Inspect network status', { action: 'assist.next_action', context: { ...context, role: 'operator' } });
    expect(created.nextActionProposal.valid).toBe(true);
    const step = created.wbs[0];
    const updated = registry.completeWbsStep(created.taskId, step.id, 'Observed current state');
    expect(updated.nextActionProposal).toBeTruthy();
    expect(updated.nextActionProposal.taskId).toBe(created.taskId);
  });

  test('records bounded proactive telemetry and computes acceptance metrics', () => {
    const telemetry = new ProactiveTelemetry({ maxEvents: 4 });
    telemetry.record({ type: 'proposal_created', proposalId: 'p1', userId: 'u1' });
    telemetry.record({ type: 'proposal_accepted', proposalId: 'p1', userId: 'u1' });
    telemetry.record({ type: 'action_executed', proposalId: 'p1', userId: 'u1' });
    expect(telemetry.summary({ userId: 'u1' }).acceptanceRate).toBe(1);
    telemetry.record({ type: 'proposal_dismissed', proposalId: 'p2', userId: 'u1' });
    telemetry.record({ type: 'proposal_dismissed', proposalId: 'p3', userId: 'u1' });
    expect(telemetry.list({ userId: 'u1' }).length).toBe(4);
  });

  test('redacts credentials and exposes proposal controls only for valid proposals', () => {
    expect(sanitizeWebMcpObservation('Authorization: Bearer secret api_key=abc')).toContain('[REDACTED]');
    expect(webMcpActionManifest({ readOnly: true }).submit.enabled).toBe(false);
    const proposal = createNextActionProposal({ task, context });
    const actions = buildProposalManifest(proposal, { ...context, uiPolicy: { restricted: false, actions: ['assist.next_action', 'assist.clarify'] } });
    expect(actions.map((item) => item.action)).toEqual(expect.arrayContaining(['assist.continue', 'assist.clarify', 'assist.snooze', 'assist.dismiss']));
  });
});
