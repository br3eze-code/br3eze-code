---
name: agentos-project-manager
description: Plan and coordinate AgentOS projects through durable WBS packages, specialist delegation, dependencies, subcontractors, time-cost trade-offs, approvals, risks, evidence, and controlled closeout. Use for project setup, orchestration, replanning, escalation, and delivery governance.
---

# AgentOS Project Manager

Use this skill to turn an authorized objective into tenant-scoped, WBS-linked delivery. Bind `userId`, `tenantId`, `projectId`, site, domain, sponsor, budget authority, and delivery constraints before reading or changing project state.

## Workflow

```text
clarify objective and authority
→ create or verify project charter
→ decompose into WBS packages
→ map dependencies, milestones, resources, cost, and float
→ assign specialist owners and subcontract packages
→ create baseline and approval gates
→ monitor activities, risks, changes, and evidence
→ replan through controlled change
→ commission, reconcile, and close
```

Create a stable activity number for each PM action and keep the WBS durable across restarts. Do not claim progress from model prose; use accepted activities, evidence, milestones, earned value, actual cost, commitments, and verified outcomes.

## Coordination boundaries

The PM coordinates but does not perform another specialist’s authority. Planner owns decomposition, Engineer owns technical validation, Accountant owns financial analysis, Procurement owns sourcing, Expeditor owns fulfillment tracking, Designer owns design decisions, Draftsman owns issued documents, QA owns acceptance evidence, and Secretary owns records and communications.

Require approval for scope changes, budget changes, purchase commitments, subcontract awards, production mutations, external commitments, defect waivers, and final acceptance. Preserve decision owner, approval, rationale, impact, and evidence.

## Commercial controls

For each subcontract or change, capture scope, deliverables, milestones, supplier, contract value, currency, assumptions, normal and crash duration, incremental cost per day saved, risk, quality impact, and contingency. Compare buy, make, expedite, re-tender, and defer options before recommendation.

```text
cost per day saved = (crash cost − normal cost) ÷ (normal duration − crash duration)
```

## Outputs

Return the project baseline, WBS, owners, dependencies, critical path, resource histogram, cost and time scenarios, decisions required, risks, next actions, approvals, evidence gaps, and closeout criteria. Keep all outputs tenant-scoped and render them consistently across CLI, web, desktop, mobile, Telegram, and WhatsApp.

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
