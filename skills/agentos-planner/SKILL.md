---
name: agentos-planner
description: Plan and control AgentOS project work with tenant-scoped objectives, WBS decomposition, dependencies, milestones, critical path, resource and cost trade-offs, handoffs, and closeout. Use when creating or updating project plans, schedules, tickets, or specialist work packages.
---

# AgentOS Planner

Use this skill to turn an authorized objective into a measurable, dependency-aware WBS. Require `userId`, `tenantId`, `projectId`, and applicable `siteId` and `domain` before reading or changing project state.

## Workflow

```text
clarify objective and constraints
→ define acceptance criteria
→ decompose into WBS packages
→ assign roles and predecessors
→ baseline dates, resources, cost, and float
→ create activity numbers
→ monitor evidence and blockers
→ propose replan or escalation
→ verify closeout
```

Use the canonical package sequence:

```text
PLN-001 objective and success criteria
→ PLN-002 work-package decomposition
→ PLN-003 baseline schedule and critical path
→ PLN-004 handoffs, blockers, and approved replans
→ PLN-005 closeout review
```

## Activity contract

Record every package as a stable activity such as `ACT-PLANNER-WP-PLN-002`. Include tenant, project, site, role, WBS ID, predecessors, expected outcome, acceptance criteria, planned and forecast dates, float, evidence references, owner, and approval state.

Use forward and backward scheduling to calculate early start, early finish, late start, late finish, total float, free float, and critical-path status. Do not describe a task as late without comparing actual dates with the approved baseline and current dependencies.

## Planning rules

Ask for missing outcome, scope, deadline, constraints, budget, resources, acceptance criteria, and decision authority. Keep assumptions separate from commitments. Identify the critical path and show which activities consume float. When replanning, preserve the original baseline and create a change record with time, cost, quality, and scope impact.

Assign each activity one accountable role and an explicit receiving role for handoff. Do not assign technical implementation, payment, procurement commitment, or QA acceptance to the Planner unless a separate authorized role performs it.

## Approval and evidence

`plan.create` and `plan.update` may prepare proposals. Require approval for `plan.execute_mutation` when changing an approved baseline, removing scope, changing contractual milestones, reallocating budget, or committing resources.

Close a planning package only when its WBS records, dependencies, owners, acceptance criteria, decisions, risks, and evidence are complete. A model-generated schedule is a proposal until persisted and approved.

## Outputs

Return a structured planning result containing:

```text
objective
scope and exclusions
WBS packages
owners and predecessors
baseline and forecast
critical path and float
resource and cost assumptions
risks and blockers
required approvals
next action
```

Render the same activity number and status in CLI, Telegram, WhatsApp, web, desktop, and mobile. Preserve tenant isolation and restart-safe durable state.
