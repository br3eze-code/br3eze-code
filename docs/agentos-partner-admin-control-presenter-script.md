# AgentOS Partner and Admin Control Architecture
## Presenter Script for the Four-Page PDF

### Page 1 — Partner bots are the operating edge of a centrally governed platform

This opening page frames the central idea: AgentOS is not merely a collection of Telegram bots or device connectors. It is a platform control plane that allows different white-label partners to operate services while preserving common governance, billing, AI, hardware, and audit capabilities.

The partner bot is the operating edge because it is where customers and field teams interact with the platform. The governance remains centralized. AgentOS decides which tenant, role, site, plan, device, and payment workflow the user can reach. That division lets the product scale across connectivity, CCTV, managed network operations, hardware distribution, and AI-assisted support without giving every partner a separate, uncontrolled system.

The figures and tenant names in this architecture are illustrative planning values. They communicate the intended multi-region operating model rather than audited revenue or customer disclosures.

### Page 2 — Shared capabilities create leverage across every tenant

The second page shows the three shared capability groups. The AI Core provides model-assisted reasoning and operational workflows. Billing provides the platform ledger, partner revenue-share calculations, and payment controls. Hardware and Inventory connects physical distribution—such as MikroTik, CCTV equipment, and LTE SIMs—to the same partner operating model.

The important design choice is reuse. A partner should not need a custom payment database, custom device-control policy, and separate AI gateway. Those functions remain common services with tenant-scoped access. This improves consistency and allows AgentOS HQ to enforce security, metering, reconciliation, and support standards across regions.

The highlighted statement is the ownership boundary: AgentOS owns runtime, policy, settlement, and audit. Partners receive capabilities inside an explicit scope.

### Page 3 — White-label partners operate regional service networks

This page moves from platform capability to commercial structure. Each partner represents a tenant with its own region, site count, customer base, and commercial ledger. The model supports different currencies and markets, but it does not imply that one partner can inspect or settle another partner’s records.

The partner bot can expose approved plans, customer service, stock views, wallet information, and payment initiation. It must resolve prices and terms from server-side plans. A callback or AI-generated action can identify a plan, but it cannot set the price or partner share.

The same tenant boundary applies to managed MikroTik sites, CCTV systems, Starlink terminals, inventory, vouchers, and customer records. Regional operations are an assignment and authorization concern, not a reason to duplicate the platform.

### Page 4 — Admin control protects the partner layer

The final page explains the control plane. Tenant registry defines ownership. Tiered RBAC decides which user may perform which operation in which region, partner, site, or terminal scope. Partner bot lifecycle manages creation, startup, token rotation, suspension, and retirement. Payment and escrow settlement verifies payment and credits the partner exactly once. Audit and reconciliation make every sensitive action traceable.

The partner bot is intentionally narrower than the admin plane. It is partner-scoped, uses short-lived state, and never exposes raw credentials. The admin plane is platform-owned, policy-enforced, and auditable. This distinction is critical for payment safety and device operations: a partner can request a reboot, refund, or settlement view only if its role and current scope permit it, while AgentOS retains the final enforcement boundary.

Close by emphasizing the operating principle: **AgentOS owns the runtime and policy; partners own their business scope; administrators own platform governance.** That separation is what makes the system reusable across markets and domains.
