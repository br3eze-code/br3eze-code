---
name: agentos-specialist-swarm
description: Coordinate AgentOS specialist work across Planner, Engineer, Accountant, Secretary, Procurement, Expeditor, Designer, and Draftsman roles. Use for role onboarding, WBS delegation, skill selection, activity tracking, handoffs, approvals, evidence, channel rendering, procurement exceptions, and project delivery coordination.
---

# AgentOS Specialist Swarm

Use this skill to turn an authorized request into tenant-scoped, WBS-linked work performed by the correct specialist. Treat each specialist as a role-bound executor, not a general-purpose chatbot.

## Core workflow

```text
identity and scope
→ objective and constraints
→ WBS package and dependencies
→ responsible specialist
→ permitted skill and capability
→ activity number and expected outcome
→ answer, clarify, propose, or execute
→ evidence capture
→ approval, handoff, and chart update
```

Require `userId`, `tenantId`, and applicable `projectId`, `siteId`, and `domain`. Resolve the role through the canonical profile. Role descriptions do not grant permission; enforce authorization through tenant policy, execution context, capability checks, and approval services.

Use the durable WBS as the source of ownership and dependency state. Never mark work complete from a conversational claim alone.

## Activity contract

Create or update a stable activity for every specialist package:

```json
{
  "activityNumber": "ACT-ENGINEER-WP-ENG-004",
  "tenantId": "tenant-001",
  "projectId": "project-001",
  "siteId": "site-001",
  "domain": "general",
  "wbsId": "WP-ENG-004",
  "agentRole": "engineer",
  "skillId": "implementation-and-test",
  "status": "proposed",
  "expectedOutcome": "Approved change implemented and verified",
  "acceptanceCriteria": [],
  "evidenceRefs": [],
  "requiresApproval": true,
  "approvalId": null,
  "handoffTo": null,
  "channel": "cli"
}
```

Preserve the deterministic activity number across Telegram, WhatsApp, CLI, web, desktop, and mobile. Aggregate charts by activity, not by model messages.

## Role contracts and WBS

| Role | Use for | Canonical capabilities | Approval-required actions | WBS sequence |
|---|---|---|---|---|
| Planner | Objectives, WBS, dependencies, milestones, critical path, replanning, closeout | `plan.read`, `plan.create`, `plan.update`, `context.read`, `proposal.create` | `plan.execute_mutation` | PLN-001 → PLN-002 → PLN-003 → PLN-004 → PLN-005 |
| Engineer | Diagnostics, technical baselines, risk analysis, implementation, tests, rollback | `diagnostics.read`, `code.read`, `code.propose`, `tool.execute` | `code.write`, `config.write`, `deploy`, `device.mutation` | ENG-001 → ENG-002 → ENG-003 → ENG-004 → ENG-005 |
| Accountant | Period, currency, cost baseline, reconciliation, forecasts, variance, closeout | `ledger.read`, `invoice.read`, `reconciliation.propose`, `report.create` | `payment.create`, `refund`, `settlement.release`, `ledger.write` | ACC-001 → ACC-002 → ACC-003 → ACC-004 → ACC-005 |
| Secretary | Stakeholders, meetings, decisions, communications, follow-up, records | `calendar.read`, `calendar.propose`, `message.draft`, `record.read`, `task.create` | `message.send`, `calendar.commit`, `record.share` | SEC-001 → SEC-002 → SEC-003 → SEC-004 → SEC-005 |
| Procurement | Requirements, specifications, suppliers, quotes, tenders, purchase proposals, receipts | `catalog.read`, `supplier.read`, `quote.compare`, `purchase.propose`, `inventory.read` | `purchase.order`, `supplier.commit`, `budget.allocate` | PRO-001 → PRO-002 → PRO-003 → PRO-004 → PRO-005 |
| Expeditor | Fulfillment milestones, courier tracking, exceptions, escalations, receipt closure | `order.read`, `shipment.read`, `milestone.read`, `exception.propose`, `notify.draft` | `shipment.change`, `vendor.escalate`, `notify.send` | EXP-001 → EXP-002 → EXP-003 → EXP-004 → EXP-005 |
| Designer | Requirements, principles, concepts, prototypes, design reviews, design packages | `requirements.read`, `design.propose`, `prototype.create`, `review.request` | `design.publish`, `asset.publish`, `brand.change` | DES-001 → DES-002 → DES-003 → DES-004 → DES-005 |
| Draftsman | Source control, drafts, drawings, diagrams, specifications, revisions, issue | `document.read`, `document.draft`, `diagram.draft`, `specification.create`, `revision.propose` | `document.publish`, `drawing.issue`, `specification.approve` | DRF-001 → DRF-002 → DRF-003 → DRF-004 → DRF-005 |

Use the exact repository package objectives when instantiating WBS records. The first package is normally `ready`; later packages remain `proposed` until dependencies pass.

## Specialist operating rules

**Planner:** clarify outcome, constraints, and acceptance criteria; create dependency-aware packages and schedule; never execute another role’s mutation.

**Engineer:** inspect first, record risks and rollback, propose the smallest safe change, implement only in an authorized environment, and attach test evidence.

**Accountant:** verify period, currency, tenant, and source records; keep estimates, commitments, actuals, and forecasts distinct; never release funds or rewrite a ledger without approval.

**Secretary:** prepare stakeholder registers, agendas, decisions, drafts, and follow-ups; drafting is not sending, and recording a decision is not making it.

**Procurement:** validate requirement, technical acceptance criteria, budget, supplier evidence, price, currency, lead time, quality, and risk; never commit a supplier without approval.

**Expeditor:** verify order, provider event, milestone, and scope; create delay activities and handoffs; never record shipment creation after a failed provider call; never change settled payment state because delivery is delayed.

**Designer:** extract needs, constraints, alternatives, trade-offs, prototypes, and review findings; never publish shared design or brand assets without approval.

**Draftsman:** confirm source and revision, draft, apply standards, resolve comments, and issue only approved documents; never treat a draft as the current instruction.

## Ask Engine and handoffs

Classify requests as `answer`, `clarify`, `propose`, or `execute`. Ask for missing scope, requirements, deadlines, acceptance criteria, recipient, supplier, order, or approval information. Use read-only skills to gather facts. Prepare proposals for decisions. Recheck identity, tenant scope, role, capability, WBS dependency, and approval immediately before execution.

Apply the same mutation guard to rule-based shortcuts and model tool calls. Never let a keyword route bypass approval.

A handoff must contain source activity and WBS, receiving role and activity, tenant/project/site scope, status, expected outcome, evidence, open risks, required decision, and next action. The receiver must acknowledge, accept, request clarification, or reject with a reason.

## Expeditor–Procurement exception flow

When a delay occurs:

```text
Expeditor verifies event and milestone
→ creates exception activity
→ hands to Procurement
→ Procurement obtains supplier response and commercial data
→ recovery options are prepared
→ Project Manager or budget owner approves or rejects
→ responsible service executes approved recovery
→ Expeditor tracks revised milestone
→ QA or receiver verifies delivery
→ exception closes with evidence
```

Options include expedite, partial delivery, alternate supplier, re-tender, buy-versus-make review, scope replan, or acceptance of delay. Include schedule, cost, quality, supplier, and critical-path impact in the proposal.

## Commerce proof and customer assurance

For commerce work reconcile:

```text
order
↔ transaction and payment proof
↔ invoice
↔ courier tracking
↔ specialist activity
↔ exception or change record
```

The transaction proves the financial event; order and courier records prove fulfillment. Preserve tenant, project, site, order, payment, tracking, and activity references. Customer updates should state verified facts, current status, responsible role, next action, and next update time. Exclude other tenants, private identifiers, supplier margins, credentials, raw model reasoning, and unverified predictions.

## Onboarding and readiness

Bind identity and scope, attach the role profile, seed WBS packages, register permitted skills, apply channel policy, and run supervised exercises. Test read-only work, proposal generation, evidence capture, handoffs, cross-tenant rejection, and approval blocking for every mutation capability.

Mark a specialist `ready` only when identity isolation, WBS dependencies, skills, approval gates, activity numbering, channel parity, handoff, and closure tests pass. Persist the readiness record with role, user, tenant, project, verified skills, approval tests, supervisor, and timestamp.

## Safety invariants

Never cross tenant, project, site, or domain scope. Never use a role label as authorization. Never turn a proposal into an execution result. Never close work without evidence and acceptance criteria. Never let a channel shortcut bypass policy. Never expose private records in customer updates. Preserve WBS, activity, transaction, order, courier, approval, and audit references across restarts.

## Shared AgentOS operating contract
This is specialist procedure, not a second execution system or permission grant.
### Architecture and ownership
- One execution owner: `src/core/agentRuntime.js`; compatibility shims are not parallel runtimes. Reuse the single gateway owner and its routes.
- WBS/work package = why/where; specialist = accountable who; skill = how; tool/adapter = what executes; policy = whether allowed; evidence/event = what happened; verification = acceptance.
- Follow identity/scope → WBS/dependencies → accountable specialist → skill → declared tool → policy/approval → bounded execution → observation → verification → evidence/event → next work item.
- Reuse canonical registries, activity/task records, event stores, and domain owners. PWA/web, CLI, desktop/mobile, and configured messaging channels are adapters, not alternate policy owners.
### Boundaries and handoffs
- Own only this skill's state/record. Route by the state that changes, not the channel or phrasing. Every work package needs owner, dependencies, capability/skill, tools, policy, acceptance criteria, evidence, outcome, and activity/event record.
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
