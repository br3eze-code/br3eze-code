import express from 'express';
import { getTaskRegistry } from '../../core/taskRegistry.js';
import { getUserTask } from '../../core/user-task-service.js';
import { createNextActionProposal, validateNextActionProposal } from '../../core/next-action-planner.js';
import { recordProactiveDecision } from '../../core/proactive-policy.js';
import { ProactiveTelemetry } from '../../core/proactive-telemetry.js';
import { requireUser } from '../middleware/auth-provider.js';

const router = express.Router();
const telemetry = new ProactiveTelemetry();

function proposalContext(req) {
  const user = req.user || {};
  const userId = user.userId || user.uid || user.sub || user.id;
  const trusted = {
    userId,
    tenantId: user.tenantId || user.tenant_id || (userId ? `user:${userId}` : null),
    role: user.role || null,
    status: user.status || null,
    domainId: user.domainId || user.domain_id || null,
    siteId: user.siteId || user.site_id || null,
    authorizedCapabilities: Array.isArray(user.authorizedCapabilities || user.capabilities)
      ? [...(user.authorizedCapabilities || user.capabilities)]
      : [],
  };
  // Trusted identity/scope is merged last so request-body claims cannot impersonate a user.
  return { ...(req.body?.context || {}), ...Object.fromEntries(Object.entries(trusted).filter(([, value]) => value !== null && value !== undefined)) };
}

function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message, code: error?.code || 'PROPOSAL_REQUEST_FAILED' });
}

router.post('/analysis/:domain', requireUser, (req, res) => {
  try {
    const context = { ...proposalContext(req), domain: req.params.domain, domainId: proposalContext(req).domainId || req.params.domain };
    const task = req.body?.taskId ? getUserTask(req.body.taskId, context) : null;
    const proposal = createNextActionProposal({ task, context });
    const validation = validateNextActionProposal(proposal, { task, context });
    if (!validation.valid) return res.status(422).json({ error: 'Proposal validation failed', errors: validation.errors });
    telemetry.record({ type: 'proposal_created', proposalId: proposal.proposalId, taskId: task?.taskId || null, userId: context.userId, channel: context.channel || null, confidence: proposal.candidates[0]?.confidence, risk: proposal.candidates[0]?.risk });
    return res.json(proposal);
  } catch (error) { return sendError(res, error); }
});

router.get('/tasks/:taskId/proposals', requireUser, (req, res) => {
  try {
    const context = proposalContext(req);
    const task = getUserTask(req.params.taskId, context);
    const proposal = task.nextActionProposal;
    const validation = validateNextActionProposal(proposal, { task, context });
    if (!validation.valid) return res.status(409).json({ error: 'Stored proposal is no longer valid', errors: validation.errors });
    telemetry.record({ type: 'proposal_viewed', proposalId: proposal.proposalId, taskId: task.taskId, userId: context.userId, channel: context.channel || null });
    return res.json(proposal);
  } catch (error) { return sendError(res, error); }
});

router.post('/proposals/:proposalId/decide', requireUser, (req, res) => {
  try {
    const context = proposalContext(req);
    const task = getTaskRegistry().list().find((candidate) => candidate.nextActionProposal?.proposalId === req.params.proposalId);
    const authorizedTask = getUserTask(task?.taskId, context);
    const proposal = authorizedTask.nextActionProposal;
    const validation = validateNextActionProposal(proposal, { task: authorizedTask, context });
    if (!validation.valid) return res.status(409).json({ error: 'Proposal is no longer valid', errors: validation.errors });
    const decision = recordProactiveDecision({ proposalId: proposal.proposalId, decision: req.body?.decision, userId: context.userId, channel: context.channel || null });
    if (decision.decision === 'approve' && proposal.candidates?.[0]?.requiresApproval !== true) {
      return res.status(409).json({ error: 'This proposal does not require approval', code: 'PROPOSAL_APPROVAL_NOT_REQUIRED' });
    }
    getTaskRegistry().update(authorizedTask.taskId, { proactiveDecision: decision });
    const type = ({ continue: 'proposal_accepted', clarify: 'proposal_clarified', snooze: 'proposal_snoozed', dismiss: 'proposal_dismissed', approve: 'proposal_accepted' })[decision.decision];
    telemetry.record({ type, proposalId: proposal.proposalId, taskId: authorizedTask.taskId, userId: context.userId, channel: context.channel || null, risk: proposal.candidates?.[0]?.risk });
    return res.json({ ok: true, decision });
  } catch (error) { return sendError(res, error); }
});

export { proposalContext, telemetry };
export default router;
