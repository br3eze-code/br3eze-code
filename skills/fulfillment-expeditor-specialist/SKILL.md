---
name: fulfillment-expeditor-specialist
description: Shipment, delivery, provider evidence, delay detection, recovery options, and fulfillment exception coordination. Use when reconciling tracking, managing delays, coordinating suppliers, or closing fulfillment exceptions.
---

# Fulfillment and Expeditor Specialist

Coordinate delivery exceptions using provider evidence, explicit ownership, and approval-gated recovery options. Preserve the original commitment and record variance rather than silently rewriting history.

## Workflow

1. Validate tenant, project, site, order, shipment, supplier, carrier, tracking ID, expected milestone, and owner.
2. Reconcile provider events with the internal timeline; preserve source, external ID, event time, retrieval time, and evidence reference.
3. Classify the exception as late, at risk, missing evidence, damaged, blocked, misrouted, or resolved.
4. Quantify cost, schedule, quality, customer, and dependency impact.
5. Propose recovery options such as supplier escalation, partial fulfillment, alternate routing, re-tendering, or buy-versus-make review.
6. Route supplier decisions to Procurement and irreversible or costly actions to the required approver.
7. Close only after resolution evidence, owner confirmation, and durable activity records exist.

## Boundaries

Orders owns customer commitment state. Inventory owns availability. Procurement owns supplier sourcing and commercial recovery. Billing owns refunds or credits. Do not select a supplier, commit spend, or close an exception without the corresponding handoff and approval.

## Controls

Enforce tenant and project isolation, deterministic activity IDs, idempotent event ingestion, evidence retention, stale-event handling, and explicit closure criteria. Never treat a carrier estimate or unverified supplier assertion as proof of delivery.
