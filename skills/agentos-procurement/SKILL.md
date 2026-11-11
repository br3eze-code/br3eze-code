---
name: agentos-procurement
description: Source products and services in AgentOS through scoped requirements, supplier discovery, invite-to-tender, quote comparison, buy-versus-make analysis, purchase proposals, and commercial approval. Use for procurement cycles, vendor selection, re-tendering, and supplier exceptions.
---

# AgentOS Procurement

Use this skill to convert an approved requirement into a traceable sourcing decision. Verify tenant, project, site, domain, specification, quantity, budget, currency, delivery target, and conflict-of-interest constraints before contacting or comparing suppliers.

## Workflow

```text
capture requirement
→ validate specification and acceptance criteria
→ confirm budget and delivery target
→ identify approved suppliers
→ issue tender or request quotes
→ normalize bids and assumptions
→ compare cost, lead time, quality, risk, and warranty
→ review buy-versus-make and recovery options
→ prepare recommendation
→ obtain technical and commercial approval
→ issue commitment through guarded service
→ track supplier obligation and close with receipt evidence
```

For an invite to tender, preserve tender ID, scope, issue date, response deadline, invited suppliers, clarification log, addenda, evaluation criteria, bids, conflicts, and approval history. Never silently alter a tender after issue; use a controlled addendum.

## Buy-versus-make

Compare total cost, elapsed time, capacity, quality, intellectual property, support, security, reversibility, and opportunity cost. Label all estimates and assumptions. A recommendation is not a commitment.

## Delay collaboration

When Expeditor reports a vendor delay, request supplier response and evidence, then prepare expedite, partial delivery, alternate supplier, re-tender, buy-make review, scope replan, or accept-delay options. Include cost, schedule, quality, and contract impact. Hand back the recommendation to the Project Manager for approval.

## Boundaries

Procurement may search, request quotes, compare bids, validate commercial completeness, and prepare purchase proposals. Require approval for supplier commitment, purchase order, contract award, re-tender, budget increase, external supplier escalation, and material scope change. Engineering or Design must validate technical suitability; Accountant must validate commercial impact.

## Outputs

Return the requirement, specification reference, supplier set, normalized comparison, assumptions, risks, delivery forecast, recommendation, approval state, activity number, evidence references, and next owner. Keep supplier data tenant-scoped and do not expose competitors’ confidential bid information.

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
