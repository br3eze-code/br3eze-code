# Domain-Agnostic Auth, Logistics & Inventory WBS

## Principle
Core domains consume normalized contracts. OAuth/OIDC identity providers, courier/carrier APIs, warehouses, stock systems and commerce channels are replaceable adapters.

## WBS

### A1 Identity provider discovery
- Register provider metadata: issuer, protocol, authorization/token/userinfo endpoints, scopes, capabilities.
- Supported pattern: OAuth 2.0 Authorization Code + PKCE; OpenID Connect when authentication/identity claims are required.
- Handoff: Auth Provider Registry → Identity Normalizer.

### A2 Authentication adapters
- Implement one adapter per provider without provider-specific logic in domain services.
- Normalize `{issuer, subject, email, name, claims}`.
- Handoff: Identity Normalizer → Account/Session service.

### A3 Client channels
- PWA: public client, Authorization Code + PKCE.
- Native/CLI: public client, Authorization Code + PKCE where interactive; device flow only where the authorization server explicitly supports and the deployment requires it.
- Backend: confidential client where applicable; secrets remain server-side.
- Handoff: Auth middleware → RequestContext.

### B1 Resource classification
- Resolve `product`, `service`, `subscription`, `voucher`, or other resource types from canonical catalog IDs.
- Never infer inventory type from UI/channel alone.
- Handoff: RequestContext → Commerce Resource Resolver.

### B2 Inventory partitioning
- Product inventory: stock, serial/batch, warehouse/bin, reservations.
- Service inventory: capacity, entitlement, activation state, service region.
- Digital inventory: voucher/license/token availability and issuance state.
- Handoff: Resource Resolver → Inventory Registry.

### B3 Inventory operations
- reserve → allocate → fulfill → release/cancel.
- Idempotency required for every externally retried operation.
- Handoff: Inventory → Order/Fulfillment.

### C1 Courier registry
- Register courier/carrier adapters by capability and service region.
- Core shipment contract: create, quote, label, track, cancel/return where supported.
- Normalize tracking events into a provider-neutral shipment event.
- Handoff: Fulfillment → Courier Registry → Courier Adapter.

### C2 Courier coverage
- Do not hard-code a finite “all couriers” list into the domain.
- Every courier is a replaceable adapter with country/service capability metadata.
- New couriers are added by registration/configuration and conformance tests, not by changing order or inventory logic.

### D1 Fulfillment orchestration
Order paid/authorized
→ inventory reservation
→ allocation
→ shipment creation (if physical)
→ service activation (if service)
→ fulfillment event
→ customer notification.

### D2 Failure handoff
- Payment failure → Payment domain.
- Inventory shortage → Inventory domain.
- Courier rejection → Logistics domain.
- Identity/session failure → Auth domain.
- Cross-domain recovery is event-driven; domains do not call each other's vendor SDKs.

## Canonical contracts

### Identity
`IdentityProvider → normalized Identity → Account/Session`

### Commerce resource
`Request → ResourceReference(type,id) → Catalog`

### Inventory
`ResourceReference → InventoryAdapter → Reservation/Allocation/Fulfillment`

### Logistics
`Fulfillment → CourierAdapter → Shipment → ShipmentEvent`

### Audit
Every handoff carries `correlationId`, `tenantId`, `actorId`, `resourceType`, `resourceId`, and `idempotencyKey` where applicable.

## Exit criteria
- No domain imports an OAuth SDK directly.
- No domain imports a courier SDK directly.
- No order flow guesses whether something is a product or service.
- Product/service/digital inventory are distinct persistence concerns behind one Inventory Registry.
- Courier integrations are capability-driven and replaceable.
- PWA and CLI authenticate through the same normalized identity boundary.
- Every cross-domain handoff is observable and idempotent.
