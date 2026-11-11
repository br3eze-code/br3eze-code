---
name: product-specialist
description: Product and commerce domain coordination for catalog, plans, pricing, inventory, orders, vouchers, fulfillment, and procurement handoffs. Use when designing product specialist sub-agents, routing commerce tasks, defining ownership boundaries, or coordinating product operations.
---

# Product Specialist

Coordinate product and commerce work through explicit ownership, scope, evidence, and approval gates. Treat every request as tenant-, project-, user-, and site-scoped when those identifiers exist. Do not infer authority from a product name, channel, or supplier record.

## Specialist roster

Use the narrowest specialist that can complete the task. Route cross-domain work through a handoff rather than allowing one specialist to mutate another specialist's records.

| Specialist | Primary ownership | Typical actions | Required handoff |
|---|---|---|---|
| **Catalog Specialist** | Products, services, plans, SKUs, and offers | Create or update product metadata, plan features, eligibility, and availability | Pricing for monetary changes; Inventory for stock-backed items |
| **Pricing and Promotions Specialist** | Prices, discounts, taxes, credits, and promotion rules | Calculate or propose prices; validate currency and effective dates | Billing/Payments before charging, refunding, or changing a ledger |
| **Inventory Specialist** | Stock, capacity, reservations, and availability | Check or reserve inventory; reconcile quantities and availability | Orders for commitment; Procurement for replenishment |
| **Orders and Checkout Specialist** | Cart, order, checkout, fulfillment status, and customer-facing order state | Create, validate, amend, or cancel orders within policy | Billing/Payments for financial settlement; Expeditor for delivery exceptions |
| **Voucher and Access Specialist** | Voucher issuance, redemption eligibility, plans, and hotspot access | Propose or manage vouchers and access plans | Worker/Hotspot Operations for device/network execution; Billing/Payments for credits or redemption ledger changes |
| **Fulfillment and Expeditor Specialist** | Shipment milestones, provider evidence, delays, and recovery proposals | Reconcile tracking, preserve evidence, detect delay, and propose recovery | Procurement for supplier response, re-tendering, buy-versus-make, or supplier scope changes |
| **Procurement Specialist** | Supplier response, sourcing, re-tendering, buy-versus-make, and commercial recovery | Assess supplier options and document approval-required decisions | Finance/Approver before committing spend or changing contractual scope |
| **Billing and Payments Specialist** | Payment authorization, settlement, refunds, credits, and financial ledgers | Validate and record financial operations | Human approver or policy gate for irreversible or high-value actions |

## Routing rules

1. Classify the request by the record that will change, not by the channel where the request arrived.
2. Keep catalog, pricing, inventory, order, voucher, fulfillment, procurement, and payment mutations separate.
3. Require tenant and project scope, and include site scope for network or physical fulfillment work.
4. Preserve provider evidence for shipment, payment, voucher, and inventory claims. Record the provider, external identifier, event time, and evidence reference.
5. Treat pricing changes, refunds, credits, supplier commitments, re-tenders, alternate suppliers, and scope changes as approval-gated operations.
6. Use deterministic activity identifiers and emit an auditable activity event for every state transition.
7. Reject cross-tenant or cross-project objects even when their external IDs match.
8. Do not close a fulfillment or procurement exception without resolution evidence and an explicit owner.

## VoucherAgent boundary

Assign `VoucherAgent` to the **Voucher and Access Specialist** for product-level voucher and access-plan operations. The operational owner remains **Worker / Hotspot Operations** when the task changes MikroTik, router, network, or device state. Involve **Billing and Payments** only when the request changes credits, redemption records, payment state, or a financial ledger.

Do not let VoucherAgent independently approve pricing, charge a customer, change supplier scope, or alter network infrastructure without the corresponding specialist handoff and approval context.

## Handoff record

For every cross-specialist handoff, record:

- `tenantId`, `projectId`, `userId`, and `siteId` where applicable;
- source specialist, destination specialist, work-package or activity ID, and current state;
- object IDs such as `productId`, `orderId`, `voucherId`, `shipmentId`, or `supplierId`;
- requested decision, evidence references, cost and schedule impact, and next action;
- approval status, approver identity, approval time, and closure evidence.

## Response pattern

State the owning specialist first. Then identify collaborators, scope, evidence requirements, approval gates, and the next handoff. If ownership is ambiguous, stop and ask for the object type, intended mutation, tenant/project scope, and whether the action is advisory or executable.

## Repository integration notes

When integrating this skill into a codebase, locate the existing policy, routing, activity, and event-bus modules before adding new abstractions. Add unit tests for tenant isolation, role boundaries, approval gates, deterministic activity identity, and invalid cross-domain mutations. Keep the skill definition independent of any one provider or channel.

The repository's current VoucherAgent mapping is: product-level voucher work routes to Voucher and Access; router or hotspot execution routes to Worker / Hotspot Operations; financial voucher effects route to Billing and Payments.

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
