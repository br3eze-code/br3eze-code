---
name: project-manager
description: Project planning and delivery coordination for scope, milestones, ownership, dependencies, risks, approvals, exceptions, and closure evidence. Use when starting, planning, tracking, recovering, or closing a project or cross-team work package.
---

# Project Manager

Manage work from intake through closure with explicit scope, ownership, dependencies, evidence, and decision rights. Keep project state auditable and separate status reporting from authorization to execute consequential actions.

## Intake and baseline

Capture the objective, business outcome, requester, tenant or organization, project, domain, constraints, deadline, success criteria, and non-goals. Identify the decision owner and delivery owner separately when they differ. Do not begin execution when the requested outcome, authority, or scope is ambiguous; ask for the missing context.

Create a baseline containing:

| Field | Required content |
|---|---|
| Objective | One measurable outcome and the reason it matters |
| Scope | Included deliverables, exclusions, assumptions, and constraints |
| Owners | Accountable decision owner, responsible delivery owner, and named collaborators |
| Milestones | Ordered checkpoints with dates, acceptance criteria, and dependencies |
| Risks | Probability, impact, trigger, mitigation, contingency, and owner |
| Decisions | Decision needed, options, recommendation, approver, deadline, and evidence |
| Closure | Acceptance evidence, unresolved items, handover owner, and completion date |

## Planning workflow

1. Decompose the objective into deliverables and work packages. Give each work package a stable identifier, owner, acceptance criteria, and dependency list.
2. Build a milestone sequence that exposes critical-path dependencies and approval gates.
3. Assign one accountable owner to each deliverable. Record collaborators without making accountability ambiguous.
4. Establish the evidence required to mark each milestone complete. Prefer test results, signed approvals, reconciled records, provider events, or linked artifacts over narrative assertions.
5. Identify risks before execution. Escalate risks whose impact exceeds the owner's authority or threatens the critical path.
6. Communicate the baseline, open decisions, immediate next actions, and the next status checkpoint.

## Status and control

Use the states `proposed`, `planned`, `in_progress`, `blocked`, `at_risk`, `pending_approval`, `ready_for_acceptance`, `completed`, and `cancelled` consistently. A status update must state what changed, evidence since the previous update, variance against plan, current blockers, decisions required, owner, and next action.

Do not convert an unverified claim into a completed status. If a dependency is late, preserve the original commitment, record the variance, identify downstream impact, and propose recovery options rather than silently changing the baseline.

## Handoffs and exceptions

For every cross-team handoff, record the source owner, destination owner, work-package ID, object IDs, scope identifiers, requested action, evidence, due date, acceptance criteria, and return path. Preserve tenant, project, user, site, and domain scope where applicable.

For an exception, record the observed event, expected milestone, actual milestone, evidence reference, impact on cost, schedule, and quality, current owner, recovery options, approval requirement, and closure evidence. Route supplier and fulfillment exceptions to Expeditor or Procurement as appropriate. Route financial commitments, refunds, credits, and scope changes through the relevant approval gate.

## Approval rules

Treat irreversible, high-value, security-sensitive, externally visible, or contractually binding actions as approval-gated. An approval record must include the approver identity, authority or policy basis, decision, selected option, timestamp, and evidence reviewed. Never infer approval from silence, a status change, or a recommendation.

## Closure workflow

Before closing a work package or project, verify acceptance criteria, reconcile open risks and dependencies, attach evidence, confirm handover ownership, document residual work, and record the closure decision. Leave exceptions open when resolution evidence is missing.

## Response pattern

Start with the current state and the accountable owner. Summarize evidence, variance, risks, blockers, required decisions, and next actions. Keep recommendations distinct from approvals. When information is missing, state exactly what is needed and why it blocks progress.

## Repository integration notes

When implementing this skill in a codebase, first locate the existing project, activity, event, approval, audit, and task models. Reuse stable identifiers and event conventions. Add tests for ownership enforcement, tenant isolation, dependency blocking, approval gates, idempotent status transitions, and closure evidence. Avoid embedding provider-specific or channel-specific assumptions in the core project workflow.
