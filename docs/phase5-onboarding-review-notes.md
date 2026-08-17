# Phase 5 onboarding review notes

Source: `/home/ubuntu/upload/pasted_content_9.txt` supplied by the user.

The proposed security chain is CHANNEL → CHANNEL IDENTITY → PRINCIPAL → TENANT MEMBERSHIP → SITE MEMBERSHIP → SITE → DEVICE → FINGERPRINT → AUTHORIZED ACTION → APPROVAL → TOOL/LOOP.

Key requirements identified in the supplied review:

- Chat IDs, phone numbers, usernames, and router IPs must never be tenant identifiers; the server derives tenancy from principal and membership records.
- RLS should cover the entire tenant data plane, including tenants, tenant_memberships, channel_identities, sites, site_memberships, onboarding_sessions, router_devices, router_fingerprints, device_enrollment_approvals, and audit_events.
- Use FORCE ROW LEVEL SECURITY where appropriate.
- Policies need both USING and WITH CHECK predicates, preferably through centralized app_current_tenant() helpers.
- Tenant authorization is insufficient without site membership, role, and permission checks.
- Approval-to-fingerprint relationships must enforce same tenant, site, and device scope with composite database relationships.
- UUID foreign keys for requested_by, approved_by, verified_by, enrolled_by, and created_by require relationship/authorization checks beyond existence.
- Audit events should be first-class records containing tenant, site, principal, channel identity, work, loop, action, resource, decision, reason, correlation/request IDs, timestamp, and metadata.
- Phase 3 execution evidence should carry work_id, loop_id, execution_id, and approval_id so channel-to-outcome traces are provable.
- Router identity should be anchored on device plus fingerprint, not IP address alone.

Initial safety conclusion from the attachment: the architecture is directionally strong but the exact schema should not ship until RLS, write checks, site authorization, composite scope constraints, audit ledger, and Phase 3 linkage are complete.
