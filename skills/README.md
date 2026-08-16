# Specialist Skills

This directory contains the repository’s **11 specialist skill definitions** for product, commerce, operations, design, and delivery coordination. Each skill is a standalone `SKILL.md` package with a clear trigger description, operating workflow, ownership boundary, and control guidance.

## Skill roster

| Skill | Primary responsibility | Use it when |
|---|---|---|
| [Designer](designer/SKILL.md) | User journeys, interaction design, design systems, accessibility, visual language, and engineering handoff | Designing or reviewing product experiences, interfaces, workflows, brand surfaces, or interaction specifications |
| [Catalog Specialist](catalog-specialist/SKILL.md) | Products, services, plans, SKUs, offers, eligibility, and catalog publication | Defining or reviewing product metadata, hierarchy, bundles, plans, or publication workflows |
| [Pricing and Promotions Specialist](pricing-promotions-specialist/SKILL.md) | Prices, discounts, taxes, credits, promotions, rounding, and commercial rules | Calculating, proposing, validating, publishing, or reviewing prices and promotions |
| [Inventory Specialist](inventory-specialist/SKILL.md) | Stock, capacity, reservations, availability, and reconciliation | Checking, reserving, releasing, reconciling, or forecasting availability |
| [Orders and Checkout Specialist](orders-checkout-specialist/SKILL.md) | Cart, checkout, orders, customer commitments, amendments, cancellation, and fulfillment state | Creating, validating, changing, or reviewing orders and checkout flows |
| [Voucher and Access Specialist](voucher-access-specialist/SKILL.md) | Voucher issuance, redemption eligibility, access plans, and hotspot entitlements | Defining, issuing, validating, redeeming, or reviewing vouchers and access plans |
| [Fulfillment and Expeditor Specialist](fulfillment-expeditor-specialist/SKILL.md) | Shipment milestones, provider evidence, delay detection, recovery, and exception closure | Reconciling tracking, managing delivery delays, coordinating providers, or closing exceptions |
| [Procurement Specialist](procurement-specialist/SKILL.md) | Supplier response, sourcing, re-tendering, buy-versus-make, and commercial recovery | Handling supplier delays, alternate suppliers, purchase decisions, or scope changes |
| [Billing and Payments Specialist](billing-payments-specialist/SKILL.md) | Payment authorization, settlement, refunds, credits, invoices, and financial ledgers | Validating or executing product-related financial operations and state transitions |
| [Product Specialist](product-specialist/SKILL.md) | Cross-domain product and commerce routing across catalog, pricing, inventory, orders, vouchers, fulfillment, procurement, and payments | Selecting the narrowest product specialist, defining handoffs, or reviewing ownership boundaries |
| [Project Manager](project-manager/SKILL.md) | Scope, milestones, owners, dependencies, risks, approvals, exceptions, and closure evidence | Starting, planning, tracking, recovering, or closing a project or cross-team work package |

## Ownership and routing model

Route work by **the record or state that will change**, not by the channel that submitted the request. Keep product definitions, commercial calculations, inventory reservations, customer commitments, entitlements, delivery evidence, supplier decisions, and financial ledgers under separate owners.

The Product Specialist provides the cross-domain routing layer. The Project Manager coordinates the work package, milestones, dependencies, risks, approvals, and closure. The Designer owns experience quality and design handoff but does not replace the product or domain owner for business controls.

| Request or state change | Primary owner | Common collaborators |
|---|---|---|
| Product, plan, SKU, or offer definition | Catalog Specialist | Pricing, Inventory, Designer |
| Price, discount, tax, credit, or promotion rule | Pricing and Promotions Specialist | Catalog, Billing, Orders |
| Stock, capacity, reservation, or availability | Inventory Specialist | Catalog, Orders, Procurement |
| Cart, order, checkout, amendment, or cancellation | Orders and Checkout Specialist | Pricing, Inventory, Billing, Fulfillment |
| Voucher or access-plan entitlement | Voucher and Access Specialist | Worker/Hotspot Operations, Billing, Catalog |
| Shipment delay, tracking mismatch, or delivery exception | Fulfillment and Expeditor Specialist | Orders, Inventory, Procurement, Billing |
| Supplier recovery, re-tender, or buy-versus-make | Procurement Specialist | Fulfillment, Inventory, Project Manager, approver |
| Payment, settlement, refund, credit, or ledger state | Billing and Payments Specialist | Pricing, Orders, Procurement, approver |
| Cross-team scope, milestone, dependency, or closure | Project Manager | All affected specialists |
| User journey, interface, accessibility, or interaction design | Designer | Product owner, Engineering, affected specialist |

## VoucherAgent ownership

Assign `VoucherAgent` to the **Voucher and Access Specialist** for product-level voucher and access-plan operations. When the task changes MikroTik, router, network, or device state, the operational owner is **Worker / Hotspot Operations**. When it changes credits, redemption records, payment state, or a financial ledger, involve **Billing and Payments**.

VoucherAgent must not independently approve pricing, charge an account, change supplier scope, or alter network infrastructure. Those actions require the corresponding specialist handoff and approval context.

## Shared controls

All specialists should preserve tenant, project, user, and site scope where applicable. They should use stable identifiers, explicit state transitions, idempotency for retried operations, evidence-backed status, deterministic activity records, and approval gates for irreversible, high-value, externally visible, security-sensitive, or contractually binding actions.

A cross-specialist handoff should identify the source and destination owners, work-package or activity ID, scoped object IDs, requested action, evidence references, due date, acceptance criteria, approval status, and return path. Do not close an exception or work package without resolution or acceptance evidence.

## Validation status

All 11 `SKILL.md` files passed the skill package validator, and the repository diff passed `git diff --check`. The skill files were added in commit [`0c0c694`](https://github.com/br3eze-code/br3eze-code/commit/0c0c694ce79ea228eefd83f0a9261819296c40ac), titled `feat: add designer and product specialist skills`.

The repository-wide audit remains separate from skill validation. At the audited remote baseline, the Jest suite reported **85 passing suites and one failing suite** because `src/core/fulfillment-exception-coordinator.js` imports the missing `src/core/specialist-activity.js` module.
