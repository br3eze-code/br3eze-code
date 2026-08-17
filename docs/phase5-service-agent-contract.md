# Phase 5 Service-Agent and Customer-Plane Contract

## Purpose

This contract defines the authority boundary for Br3eze Africa's managed network service. **AgentOS is the Br3eze control plane. Power Connect is the customer operational plane.** WhatsApp, Telegram, PWA, technician, and CLI are interfaces used by Br3eze service agents; they are not independent tenant authorities.

## Canonical tenant contact specialist

Every customer tenant has one designated contact specialist identity:

```text
specialistId = br3eze-code
specialistRole = br3eze-service-agent
provider = br3eze-africa
```

The tenant contact person is represented by a tenant-scoped principal and membership record, but the operational specialist assigned to that contact is always `br3eze-code`. A channel transport identifier, phone number, chat ID, username, router IP, or device fingerprint must never be used as the tenant identifier or specialist identity.

The invariant is:

> `tenant.contactSpecialistId === "br3eze-code"`

A tenant may have additional internal Br3eze roles and customer members, but no onboarding or support request may silently replace the canonical contact specialist. Specialist selection remains subject to tenant, site, capability, policy, and approval checks.

## Authority chain

```text
channel
  -> channel identity
  -> authenticated principal
  -> tenant membership
  -> site membership
  -> site
  -> device enrollment
  -> fingerprint verification
  -> authorized action
  -> approval where required
  -> AgentOS Work/Loop execution
  -> device adapter or customer-plane response
  -> evidence and audit ledger
```

The same authority chain applies to a channel-originated request and to a Power Connect request. The channel and UI are presentation surfaces; AgentOS remains the policy and execution authority.

## Service-agent boundary

A Br3eze service agent may discover or create a customer through an approved onboarding flow, establish an onboarding session, create a tenant and initial site, issue a short-lived pairing artifact, coordinate device enrollment, prepare a baseline, request approval, and hand the customer to Power Connect. It may not directly pass channel credentials to a router adapter, bypass site authorization, push unapproved configuration, or treat a proposal as a completed operation.

## Onboarding lifecycle

```text
TENANT_CREATED
  -> SITE_CREATED
  -> DEVICE_CLAIMED
  -> DEVICE_DISCOVERED
  -> FINGERPRINT_CAPTURED
  -> IDENTITY_VERIFIED
  -> BASELINE_PREVIEWED
  -> APPROVAL_PENDING
  -> CONFIGURATION_APPLIED
  -> CONNECTIVITY_VERIFIED
  -> SITE_ACTIVATED
  -> MONITORING
```

Every transition is machine-enforced, tenant-scoped, idempotent, and recorded as an audit event. A mismatch enters quarantine and cannot advance to configuration without a new approved decision.

## Pairing contract

A WhatsApp or Telegram onboarding session creates a short-lived, single-use pairing artifact. Power Connect redeems the artifact after authenticating the customer principal. Redemption links both sessions to the same onboarding session; it does not grant unrestricted tenant access. The server derives tenant and site scope from the onboarding session and membership records.

Pairing artifacts must contain no router credentials, must be stored as a hash, must expire, must be single-use, and must produce an audit event on issue, redemption, expiry, replay, or rejection.

## Device boundary

MikroTik, access points, and future network hardware are device adapters behind an AgentOS device-management boundary. AgentOS owns enrollment policy, identity verification, approval, execution evidence, and audit. An adapter owns protocol-specific discovery, fingerprinting, configuration, and connectivity checks. IP address alone is not device identity.

## Required trace linkage

Onboarding actions must preserve these references across Work, Loop, Action, and Evidence records:

| Reference | Requirement |
|---|---|
| `tenantId` | Required on every tenant-plane record and must be server-derived or validated. |
| `siteId` | Required for site/device actions and checked against site membership. |
| `principalId` | Authenticated actor; channel transport IDs are not substitutes. |
| `channelIdentityId` | Link to the originating channel identity when applicable. |
| `workId`, `loopId`, `executionId` | Required for governed execution traceability. |
| `approvalId` | Required for approval-gated mutations. |
| `correlationId`, `requestId` | Required for cross-channel and retry-safe audit correlation. |

## Release gate

Phase 5 is not production-ready until cloud persistence, tenant RLS, `USING` and `WITH CHECK` policies, site authorization, composite scope constraints, secret references, first-class audit events, device-adapter enrollment, pairing replay protection, and regression tests are implemented and evidenced.
