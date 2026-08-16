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
