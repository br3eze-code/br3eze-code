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

## Shared AgentOS operating contract
This is specialist procedure, not a second execution system or permission grant.
### Architecture and ownership
- One execution owner: `src/core/agentRuntime.js`; compatibility shims are not parallel runtimes. Reuse the single gateway owner and its routes.
- WBS/work package = why/where; specialist = accountable who; skill = how; tool/adapter = what executes; policy = whether allowed; evidence/event = what happened; verification = acceptance.
- Follow identity/scope → WBS/dependencies → accountable specialist → skill → declared tool → policy/approval → bounded execution → observation → verification → evidence/event → next work item.
- Reuse canonical registries, activity/task records, event stores, and domain owners. PWA/web, CLI, desktop/mobile, and configured messaging channels are adapters, not alternate policy owners.
### Boundaries and handoffs
- Own only this skill's state/record. Route by the state that changes, not the channel or phrasing. Each work package needs owner, dependencies, capability/skill, tools, policy, acceptance criteria, evidence, outcome, and activity/event record.
- Handoffs include source/destination owners, WBS/activity IDs, tenant/project/site/domain scope, object IDs, requested action, evidence, due date, acceptance criteria, approval status, and return path.
- Keep catalog, pricing, inventory, orders, vouchers/access, fulfillment, procurement, and billing/payment ownership separate. Project Manager coordinates; Product Specialist routes commerce; neither silently assumes domain authority.
### Permissions and safe execution
- Skill prose is not authorization. Validate identity, tenant/project/site/domain, environment, object scope, capability, and policy before access or mutation.
- Prefer read-only inspection/dry runs. Recheck authorization before consequential changes. Approval is required for irreversible, high-value, externally visible, security-sensitive, payment, deployment, device/network, or contractually binding actions.
- Never expose secrets, tokens, OTPs, passwords, or unnecessary personal data. Enforce tenant isolation and redact evidence/logs.
- Use stable IDs, explicit state transitions, idempotency, bounded retries/timeouts, and safe failure handling. Enforce `maxIterations`, `maxToolCalls`, `maxCost`, `maxDurationMs`, and `maxHandoffs` where supported; escalate if limits or authority are insufficient.
### Evidence and verification
- Record baseline, risks, approvals, changed resources, tool results, tests, observed result, evidence references, defects, and rollback/recovery status through existing activity/audit paths.
- Define acceptance and rollback before mutation. Add regression tests; run focused tests, relevant lint/build checks, and CI. Keep manifests/lockfiles consistent; run `npm ci` when required by repository workflows.
- Never claim tests, devices, providers, deployments, or live tenants were verified without observed results. Separate code inspection, unit tests, staging, and production evidence.
- Report outcome, owner, changes, exact checks/results, evidence, risks, approvals, and next handoff.
### Provider and environment boundaries
- Providers are swappable; every capability still has one owner. Keep Firebase, Supabase/Postgres, Vercel, AWS, Cloudflare, payment/messaging, MikroTik/RouterOS, and Starlink behavior behind adapters unless core explicitly owns it.
- Mentioned integrations do not prove live credentials or connectivity. Use only configured/authorized tools. Do not assume browser `process`, filesystem, secrets, Node APIs, or network access exist in a PWA; use the proper server/API boundary.
- Separate product entitlement/billing from router/device mutation. Disruptive network operations need scoped permission, confirmation, audit, and post-change verification.
### skills.sh compatibility
- Maintain YAML frontmatter with stable `name` and useful `description`; preserve specialist-specific instructions.
- Install with `npx skills add br3eze-code/br3eze-code --skill <skill-name>`; `npx skills list` shows workspace-installed skills, not every source package. Repository guidance specifies Node.js 22.20+.
- Installation is not runtime registration; skill prose must not replace executable modules or create another execution path.
