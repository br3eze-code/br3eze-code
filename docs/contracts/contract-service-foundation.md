# Contract service foundation

## Ownership

The Contract Service owns contract-document lifecycle and legal status. AgentRuntime remains the only agent execution owner. Authentication/authorization decides who may request a transition; the Contract Service validates the transition and records its evidence. A UI, model, signature vendor, or hosting provider must not independently mark a contract as legally approved.

## Service models

A contract may combine one or more schedules:

- **BaaS:** backend APIs, usage limits, availability, data processing, security, and provider dependencies.
- **SaaS:** subscription period, entitlements, fees, support, renewals, suspension, and termination.
- **Local / on-premises:** installation scope, customer-owned hardware, offline behaviour, backups, maintenance, and connectivity boundaries.
- **Engineering services:** statement of work, work packages, acceptance criteria, eligible costs, approved markup, and IP treatment.

These schedules share the same contract lifecycle and evidence record. They must not become separate contract authorities.

## Evidence API contract

`src/contracts/contract-evidence-service.js` is a storage-port consumer, not a complete persistence implementation or e-signature integration. The injected store must implement:

- `getHead({ tenantId, contractId })` — return the latest durable event in that contract's chain, or null.
- `appendEvidence(record, { expectedPreviousHash, idempotencyKey })` — atomically compare the current head, append once, enforce tenant-scoped idempotency, and return `{ persisted: true }` only after durable commit.

Storage errors and unconfirmed writes must fail closed. Do not silently fall back to an in-memory queue for legal evidence. The database schema must enforce tenant scope, unique idempotency keys, append-only access controls, and transactional head checks.

Each event contains tenant and contract identifiers, actor, event type, timestamp, idempotency key, prior hash, payload, and SHA-256 event hash. Signature-related events require a SHA-256 digest of the exact signed document. This chain is tamper-evident only if the storage and access-control layer prevents silent rewriting; a hash is not a signature and does not prove signer identity, consent, authority, or legal enforceability.

## Required lifecycle

`draft -> review -> approved -> sent -> partially_signed -> signed -> active -> expired/terminated`

Not every contract uses every state. State transitions must be validated by the Contract Service and authorised against the tenant and contract. Editing a document after approval creates a new immutable version and invalidates approval/signatures tied to the prior digest. Webhooks require signature verification, replay protection, idempotency, and reconciliation against the signing provider.

## Production blockers

Before production, implement and test a durable database adapter and migrations, contract version storage, role and tenant authorization, state-transition policy, template rendering, verified signing adapter, webhook verification, retention/export, recovery and monitoring. Do not claim legal compliance or enforceability from this foundation alone. Zimbabwe/UAE counsel and tax advisers must review entity authority, IP chain of title, governing law, data transfers, tax and transfer-pricing treatment.
