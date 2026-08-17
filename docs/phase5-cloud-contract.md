# Phase 5 Cloud Persistence and Device-Adapter Contract

## Boundary

AgentOS is the Br3eze Africa control plane. Power Connect is the customer plane. The cloud server is the authority boundary between channel interfaces, customer UI, durable records, and device adapters. No channel handler or UI client may connect directly to a router or read device credentials.

## Required tenant-plane records

| Record | Scope and purpose |
|---|---|
| `service_providers` | Br3eze provider identity and future provider boundary. |
| `tenants` | Customer organization, provider, and immutable `contact_specialist_id = br3eze-code`. |
| `principals` | Authenticated people or service identities. |
| `tenant_memberships` | Principal-to-tenant role and permissions. |
| `channel_identities` | WhatsApp, Telegram, PWA, technician, or CLI transport identity; never a tenant key. |
| `sites` | Tenant-scoped operational locations. |
| `site_memberships` | Principal role and permissions within a site. |
| `onboarding_sessions` | Shared WhatsApp/Telegram/Power Connect onboarding state. |
| `pairing_artifacts` | Hashed, expiring, single-use pairing token metadata. |
| `devices` | Tenant/site-scoped device identity and lifecycle. |
| `device_fingerprints` | Verified hardware identity observations; IP is only an observation. |
| `device_enrollment_approvals` | Approval decision linked to the same tenant, site, and device. |
| `device_secrets` | References to a cloud secret manager; never raw credentials in AgentOS records. |
| `audit_events` | Append-only tenant-scoped security and execution ledger. |

## RLS policy contract

The database must enable and force row-level security on every customer-plane table. A transaction-local server context sets the authenticated principal, tenant, and optional site before queries execute. Policies must include both `USING` and `WITH CHECK` predicates.

```sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_read ON tenants
  USING (id = app_current_tenant());

CREATE POLICY tenant_write ON tenants
  FOR INSERT WITH CHECK (
    id = app_current_tenant()
    AND contact_specialist_id = 'br3eze-code'
  );
```

For child records, policy evaluation must require both tenant and site scope. Foreign keys must use composite relationships where cross-scope references are possible, for example `(tenant_id, site_id)` to the corresponding parent key. Existence of a UUID alone is not authorization.

## Audit ledger contract

Every create, read of sensitive material, approval, denial, pairing issue, pairing redemption, replay rejection, device discovery, fingerprint mismatch, configuration request, adapter result, handoff, and activation must append an audit event containing:

```text
tenant_id, site_id, principal_id, channel_identity_id,
work_id, loop_id, execution_id, approval_id,
action, resource_type, resource_id, decision, reason,
correlation_id, request_id, occurred_at, metadata
```

Audit writes must be append-only to application principals. Request retries use a correlation or idempotency key so that a replay cannot create an unbounded duplicate mutation.

## Secret-management contract

Router credentials, API tokens, webhook secrets, and channel credentials are stored in a managed secret provider. Database records contain only a secret reference, version, owner scope, rotation metadata, and access audit reference. Channel messages, Work/Loop evidence, logs, and customer-visible Power Connect responses must never contain secret values.

A device adapter receives a short-lived, server-resolved credential handle only after the caller passes tenant scope, site membership, device enrollment state, policy, and approval checks. The adapter must not persist or return the resolved secret.

## Device-adapter contract

The AgentOS device-management boundary exposes protocol-neutral operations:

```text
discover(deviceClaim)
captureFingerprint(device)
verifyIdentity(device, fingerprint)
previewBaseline(device, policy)
applyBaseline(device, approvedPlan)
testConnectivity(device)
```

The MikroTik adapter implements those operations using RouterOS-specific protocols. Other routers and access points implement the same boundary independently. Device identity is anchored on a durable device record plus verified fingerprint; IP address or channel metadata is insufficient.

## Approval gates

The following operations are proposals until an approval record is valid for the exact tenant, site, device, action, and baseline hash:

```text
tenant.create
site.create
device.mutation
baseline.apply
site.activate
```

Approval validation must reject cross-tenant, cross-site, cross-device, expired, denied, already-consumed, or baseline-mismatched approvals.

## Cloud rollout prerequisites

Implementation may proceed against a repository adapter, but production activation requires a named cloud provider, managed PostgreSQL endpoint, secret-manager choice, queue/worker choice, backup and restore test, RLS policy migration, observability destination, and operator approval. Until those inputs are supplied, the cloud persistence adapter remains a contract and does not claim production readiness.
