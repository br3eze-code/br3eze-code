import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('authenticated proactive proposal API', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const router = fs.readFileSync(path.join(root, 'src/api/routes/proactive-proposals.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'api/index.js'), 'utf8');

  test('proposal routes are mounted in the versioned API and require authentication', () => {
    expect(api).toContain("app.use('/api/v1', proactiveProposalRouter)");
    expect(router).toContain("router.get('/tasks/:taskId/proposals', requireUser");
    expect(router).toContain("router.post('/proposals/:proposalId/decide', requireUser");
    expect(router).toContain("router.post('/analysis/:domain', requireUser");
  });

  test('proposal reads use canonical task access and validate stored proposals', () => {
    expect(router).toContain('getUserTask(req.params.taskId, context)');
    expect(router).toContain('validateNextActionProposal(proposal, { task, context })');
    expect(router).toContain('telemetry.record');
  });

  test('request-body context cannot override authenticated identity or scope', () => {
    const bodyContextIndex = router.indexOf('...(req.body?.context || {})');
    const trustedContextIndex = router.indexOf('...trusted', bodyContextIndex);
    expect(bodyContextIndex).toBeGreaterThanOrEqual(0);
    expect(trustedContextIndex).toBeGreaterThan(bodyContextIndex);
    expect(router).toContain('tenantId: user.tenantId || user.tenant_id');
    expect(router).toContain('domainId: user.domainId || user.domain_id || null');
    expect(router).toContain('siteId: user.siteId || user.site_id || null');
  });

  test('decision handling is constrained to the proactive policy vocabulary', () => {
    expect(router).toContain('recordProactiveDecision');
    expect(router).toContain("decision.decision === 'approve'");
    expect(router).toContain('PROPOSAL_APPROVAL_NOT_REQUIRED');
    expect(router).toContain('getUserTask(task?.taskId, context)');
  });
});

export {};
