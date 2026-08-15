# AgentOS Partner Platform

This layer models Br3eze's partner-operated infrastructure business without coupling business logic to Telegram, WhatsApp, PWA, or a specific payment provider.

## Planes

```text
Br3eze HQ
   |
AgentOS control plane
   |
+-- Identity / Policy / Events
   |
Partner tenant
   +-- Sites
   +-- Customers
   +-- Assets
   +-- Ledger account
   +-- Credit account
   +-- Capabilities
   |
Job / Service
   +-- Payment provider
   +-- Evidence
   +-- AI verification
   +-- Human review
   +-- Settlement
```

## Financial rules

- Monetary values are integer minor units (`amountMinor`), never floating-point currency values.
- Currency is explicit on every money-bearing operation.
- Payment providers are adapters; Firestore job documents are not a substitute for regulated custody.
- Partner/platform settlement is written to the ledger with an idempotency key.
- Commission plans should be versioned and referenced by ID on the tenant/job.

## Job lifecycle

```text
created -> funded -> working -> verifying -> human_review -> released
                     |                     |
                     +---------------------+-> cancelled/rejected
```

AI verification may recommend approval, but AI cannot release funds. A human-authorized release is required by policy.

## Integration boundary

Channel adapters such as Telegram should translate user actions into AgentOS application-service calls. They should not own payment calculations, ledger writes, job state transitions, or provider credentials.

Relevant modules:

- `services/partner/money.mjs` — integer-unit money and commission calculations
- `services/partner/state-machine.mjs` — explicit job transitions
- `services/partner/ledger.mjs` — immutable-style ledger append API
- `services/partner/payment-service.mjs` — provider-neutral payment boundary
- `services/partner/policy.mjs` — AI/human release policy
- `services/partner/job-service.mjs` — job and settlement orchestration
- `services/partner/escrow.mjs` — compatibility facade for protected job payments
- `services/partner/onboarding.mjs` — verified deposit to tenant provisioning
