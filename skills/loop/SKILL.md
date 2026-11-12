---
name: loop
description: Bounded, evidence-driven orchestration loop for completing tenant-scoped work through plan, execute, observe, evaluate, handoff, retry, verify, and complete.
---
# Loop Skill

The loop operates on a work package's immutable goal and acceptance criteria. It may update execution state, observations, evidence, blockers, retries, handoffs, and decisions, but it cannot change the acceptance criteria.

Every loop is bounded by `maxIterations`, `maxToolCalls`, `timeoutMs`, and `maxHandoffs`. Retryable failures may retry with bounded attempts. Business failures stop without blind retry. Permission and approval failures hand off or escalate. Completion requires verification evidence against the work package acceptance criteria.

Required state includes `loopId`, `workId`, `taskId`, `tenantId`, `specialist`, `goal`, `acceptanceCriteria`, `status`, `iteration`, `observations`, `actions`, `decisions`, `blockers`, `handoffs`, and `evidence`. Handoffs preserve work, loop, parent execution, tenant/project scope, source and destination roles, requested action, criteria, evidence, risks, and deadline.


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- Map project work to durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's domain and use explicit handoffs. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer built-ins and locked dependencies; avoid unnecessary packages. Dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation. Enforce least privilege, scope, redaction, idempotency, and explicit approval for privileged, destructive, financial, production, release, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and the next priority. Never claim unverified success.
