# Specialist Skills

This is the repository source for AgentOS skills and installable Agent Skills. It contains specialist packages, operational skills, and legacy runtime skill modules. Installable packages use one directory per skill with a `SKILL.md` containing YAML frontmatter (`name` and `description`) plus the instructions. The directory currently has 47 skill package directories; `skills/cordova/` and `skills/test/` have been standardized with `SKILL.md` files so all package directories follow the same discoverable shape.

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

Historical note: the original 11 specialist `SKILL.md` files passed the skill package validator in commit [`0c0c694`](https://github.com/br3eze-code/br3eze-code/commit/0c0c694ce79ea228eefd83f0a9261819296c40ac), titled `feat: add designer and product specialist skills`. That historical result does not certify the entire repository or the current change.

The repository-wide audit remains separate from skill validation. At the audited remote baseline, the Jest suite reported **85 passing suites and one failing suite** because `src/core/fulfillment-exception-coordinator.js` imports the missing `src/core/specialist-activity.js` module.

## Agent specialization registry

The machine-readable ownership map lives at `config/specialist-agent-roster.json`. Runtime consumers can use `src/core/specialist-agent-roster.js` to list all eleven teams, resolve a skill to its accountable team, check declared handoff boundaries, and validate dependency references.

The registry keeps routing separate from execution. A specialist may recommend or hand off work according to its declared boundary, but consequential actions still require the existing tenant, approval, evidence, and audit controls. Voucher operations belong to the Voucher and Access Specialist; financial redemption, credits, and settlement hand off to Billing and Payments.

## Installable Agent Skills (skills.sh CLI)

The root `skills/` directory is the source catalogue. To install selected packages into the current workspace with the skills CLI, use Node.js 22.20 or newer:

```bash
npx skills add br3eze-code/br3eze-code --skill cordova
npx skills add br3eze-code/br3eze-code --skill test
npx skills list
```

Use `npx skills list` to inspect skills installed in the current workspace; it is not a repository-wide inventory of every source package. Use `npx skills add` to install packages from this repository. Do not duplicate the runtime registry: these `SKILL.md` files describe agent-facing workflows, while executable skill modules and the canonical AgentRuntime remain responsible for runtime behavior and governed execution.

### Package-shape check

#### Shared operating contract coverage

All 47 skill packages now include the shared AgentOS operating contract in their `SKILL.md`. It standardizes the single `src/core/agentRuntime.js` execution owner, gateway ownership, WBS-to-specialist-to-skill-to-tool flow, policy and approval gates, tenant scope, evidence and verification, provider adapters, environment boundaries, execution budgets, and skills.sh CLI semantics. Each package retains its specialist-specific instructions; this shared section does not replace domain workflows or prove that any listed provider is connected or deployed.

Every directory intended as an installable Agent Skill should contain `SKILL.md` with valid YAML frontmatter and non-empty `name` and `description` fields. Some directories under `skills/` also contain legacy executable modules; adding a `SKILL.md` documents the workflow and does not replace those modules or register a second execution path.
