---
name: loop
description: Bounded, evidence-driven orchestration loop for completing tenant-scoped work through plan, execute, observe, evaluate, handoff, retry, verify, and complete.
---

# Loop Skill

The loop operates on a work package's immutable goal and acceptance criteria. It may update execution state, observations, evidence, blockers, retries, handoffs, and decisions, but it cannot change the acceptance criteria.

Every loop is bounded by `maxIterations`, `maxToolCalls`, `timeoutMs`, and `maxHandoffs`. Retryable failures may retry with bounded attempts. Business failures stop without blind retry. Permission and approval failures hand off or escalate. Completion requires verification evidence against the work package acceptance criteria.

Required state includes `loopId`, `workId`, `taskId`, `tenantId`, `specialist`, `goal`, `acceptanceCriteria`, `status`, `iteration`, `observations`, `actions`, `decisions`, `blockers`, `handoffs`, and `evidence`. Handoffs preserve work, loop, parent execution, tenant/project scope, source and destination roles, requested action, criteria, evidence, risks, and deadline.
