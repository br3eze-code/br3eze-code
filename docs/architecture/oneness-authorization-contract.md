# OneNess: canonical identity and authorization contract

**Principle:** one authority decides whether an actor may execute an action. Uncertainty is a denial, never an implicit grant.

## Ownership

- AgentRuntime is the only execution owner.
- `src/core/agent-authorization.js` is the canonical persistent-agent authorization boundary.
- The host-supplied identity adapter is the source of truth for credential validity, agent identity, current human tenant membership, effective policy and resource authorization.
- Model providers, tool adapters and UI clients cannot grant permissions.
- Provider adapters implement ports; they do not own policy or business authorization.

## Required decision evidence

Before an agent tool runs, the authorizer must return:

1. `credentialValid: true`.
2. An active agent identity matching the requested agent and tenant.
3. An active human membership matching the requesting user and tenant, including the authoritative membership role.
4. An active `allow` policy with an exact tool capability.
5. For resource-targeted calls, `resourceAuthorized: true` after checking the resource belongs to the same tenant and is within the membership/agent scope.

Missing, stale, mismatched or unavailable evidence denies execution. Wildcard tool grants are not accepted by this boundary.

## Role semantics

Roles are scoped to a tenant membership. A global profile role is not proof of membership in a particular tenant. Platform administration, tenant administration, partner operations and customer access must be mapped to explicit capabilities and resource scopes by the authoritative adapter.

## Approval semantics

Approval is separate from authorization. An approval request does not grant permission by itself. The approval service must authenticate the approver, verify their authority over the same tenant/resource, bind approval to the exact action and parameters, and prevent replay.

## Provider neutrality

Supabase, Firebase, SQLite and other stores may implement the host identity adapter. They must return the same decision contract. Core must not contain provider-specific role queries or bypasses.

## Legacy policy implementations

The unused `src/core/policy.js` and `src/core/agentPolicy.js` implementations were removed because they were disconnected, inconsistent and included default-allow / automatic cross-domain approval behavior. New policy logic must extend the canonical authorization boundary, not create a parallel engine.

## Scope and remaining integration

This contract hardens the persistent-agent execution boundary. It does not claim that all human-facing HTTP routes or every database RLS policy have been migrated. The host adapter must be wired to the real identity/membership/policy tables before production agent execution is enabled. The connected Supabase project previously inspected had no rows in the agent identity tables, so live authorization cannot yet be proven.
