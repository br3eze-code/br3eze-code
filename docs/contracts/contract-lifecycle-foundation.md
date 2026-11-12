# Br3eze contract lifecycle foundation

This is the initial domain layer for contract management across BaaS, SaaS and local/on-premises services. It is not a complete contract-management product and does not itself persist records, authenticate users, send documents, or verify a signature provider's webhook.

## Ownership boundaries

- **AgentRuntime** remains the single agent execution owner.
- **Contract lifecycle service** owns legal-document state transitions.
- **Authentication/authorization layer** must authenticate the actor and enforce tenant membership before calling this module.
- **Repository adapter** must provide durable, transactional persistence and optimistic concurrency.
- **Signature adapter** must verify provider webhooks, authenticate event origin, and deduplicate provider event IDs.
- **Document adapter** may render templates but must not alter an approved/sent document without creating a new version.

## Supported service models

The lifecycle accepts one or more of baas, saas, and local. Service-specific terms, pricing, data processing, support, hosting, availability and hardware obligations belong in separately versioned schedules attached to a contract version. A service model selection is not proof that a service is available or that a customer is entitled to use it.

## State transitions

    draft -> in_review -> approved -> sent -> signed -> terminated
                       -> rejected -> draft
    approved -> draft
    sent -> rejected | expired

Expired and terminated contracts are terminal in this first iteration. Any renewal should create a new contract or an explicitly modelled renewal version rather than silently reopening a signed record.

## Evidence and security requirements before production

1. Persist contract, versions, transitions and evidence in a durable transaction.
2. Store immutable document bytes or a durable immutable object reference alongside the SHA-256 hash. A hash alone cannot reconstruct a document.
3. Store every transition in an append-only audit ledger. If persistence or audit append fails, fail closed and do not report success.
4. Enforce tenant scope and role permissions on every server-side operation; client-provided tenant IDs are not authoritative.
5. Use idempotency keys and unique constraints for signature-provider event IDs. A provider callback must not itself grant authority without cryptographic/provider verification.
6. Bind every signature to the exact document hash, signer identity, provider event ID, and validated timestamp.
7. Use a transaction/outbox or equivalent design so the contract state and required audit event cannot diverge.
8. Never treat an approval request, click, typed name, or unverified webhook as a valid electronic signature by default. The appropriate signature method and legal effect depend on applicable law and the transaction.
9. Add retention, legal hold, access logging, export, deletion policy and recovery tests before storing real contracts.
10. Do not enable execution for an unverified foreign entity or use a draft transfer-pricing markup as an approved tax position.

## First-release acceptance gates

- Tenant isolation and role-denial tests pass.
- Invalid state transitions and stale document versions are rejected.
- Modified document hashes are rejected at signing.
- Duplicate and invalid signature callbacks cannot create duplicate signed records.
- Storage/audit outages do not produce a false success response.
- Migration, backup/restore and contract export tests pass.
- All three service models can be selected and each required schedule is validated.
- Qualified legal and tax reviewers approve the relevant templates, parties, jurisdiction, IP terms and transfer-pricing method before production use.
