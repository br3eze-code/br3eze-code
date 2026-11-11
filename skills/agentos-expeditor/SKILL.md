---
name: agentos-expeditor
description: Coordinate AgentOS fulfillment and delivery work with milestones, supplier and courier tracking, exception handling, recovery options, Procurement handoffs, escalation approvals, evidence, and receipt closure. Use for order delays, shipment tracking, vendor exceptions, and delivery recovery.
---

# AgentOS Expeditor

Use this skill to track what was promised, what actually happened, the impact, and the next controlled decision. Require `userId`, `tenantId`, `projectId`, `siteId`, domain, order ID, and shipment or milestone scope before reading fulfillment state.

## Workflow

```text
establish fulfillment milestones
→ record supplier or courier confirmation
→ normalize provider events
→ detect exception and impact
→ hand off to Procurement when supplier action is needed
→ prepare bounded recovery options
→ request approval for commitment or escalation
→ track revised milestone
→ verify receipt and acceptance
→ close with evidence
```

Use:

```text
EXP-001 fulfillment milestones
→ EXP-002 confirmation and progress
→ EXP-003 exception management
→ EXP-004 escalation proposal
→ EXP-005 receipt and fulfillment closure
```

## State and activity rules

Normalize provider labels into `planned`, `order_confirmed`, `ready_for_dispatch`, `dispatched`, `in_transit`, `at_destination`, `delivered`, `inspected`, `accepted`, or `closed`. Preserve the original provider status and event timestamp. Use explicit exception states such as `blocked`, `delayed`, `lost`, `damaged`, `rejected`, `provider_error`, `awaiting_customer`, or `awaiting_supplier`.

Create a stable activity such as `ACT-EXPEDITOR-WP-EXP-003` with order, tracking, provider, milestone, expected outcome, schedule and cost impact, float consumed, evidence references, owner, and handoff target.

Do not record shipment creation when the provider is unavailable or the API call failed. Do not change settled payment state because delivery is delayed. Close only after delivery, inspection, and acceptance evidence agree.

## Procurement exceptions

When a vendor delay occurs:

```text
verify event and milestone
→ create exception activity
→ request supplier response through Procurement
→ compare expedite, partial delivery, alternate supplier, re-tender, buy-versus-make, replan, or accept-delay options
→ attach time, cost, quality, and critical-path impact
→ obtain authorized approval
→ execute through the responsible service
→ track revised delivery
→ close with evidence
```

The Expeditor owns operational facts and forecasts. Procurement owns supplier and commercial analysis. The Project Manager or budget owner approves material recovery. Never escalate a vendor, change a shipment, or send an external notification without approval.

## Capabilities and approvals

Use `order.read`, `shipment.read`, `milestone.read`, `exception.propose`, and `notify.draft`. Require approval for `shipment.change`, `vendor.escalate`, and `notify.send`. Recheck tenant, order ownership, site scope, current state, and approval at execution time.

## Commerce proof

Reconcile order, transaction, invoice, courier event, activity, exception, and change records. The transaction proves the financial event; order and courier records prove fulfillment. Preserve all IDs and tenant scope. Provide customer-safe updates with verified facts, owner, next action, and next update time.

## Outputs and closure

Return current state, last verified event, baseline and forecast dates, float impact, blocker, owner, recommended next action, approval requirement, evidence, and handoff. Keep `delivered` separate from `accepted`. Close only when required receipt, inspection, QA, and commercial evidence is attached.

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
