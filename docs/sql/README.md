# Tenant-scoped mesh-group migrations

These PostgreSQL migrations implement the AgentOS scope chain:

```text
tenant
  -> tenant_user / tenant_project
  -> mesh_group
  -> site
  -> mesh_node
  -> mesh_edge
```

## Scope behavior

`agentos_tenant_users` is the authoritative membership boundary for channel users. A principal must first belong to a tenant before it can be assigned to a mesh group or site. `agentos_tenant_projects` belongs to exactly one tenant and may optionally own a mesh group. `agentos_mesh_groups` belongs to one tenant and is currently limited to one active/provisioning/suspended group per tenant by the partial unique index `uq_one_active_mesh_group_per_tenant`. The limit is intentionally represented as a plan/runtime constraint so higher plans can later allow multiple groups without changing the child tables.

Sites belong to one tenant and one mesh group. Nodes belong to one tenant, one mesh group, and one site. Edges belong to one tenant and one mesh group and can reference only nodes from the same tenant and mesh group. Composite foreign keys prevent a caller or migration from combining a tenant from one scope with a project, site, node, or edge from another scope.

## Files

| File | Purpose |
|---|---|
| `001_tenant_mesh_groups.up.sql` | Forward migration |
| `001_tenant_mesh_groups.down.sql` | Reversible rollback migration |

## Assumptions

The repository currently does not expose a canonical PostgreSQL migration runner or existing SQL definitions for `tenants`, `users`, and `projects`. Therefore this migration uses namespaced tables (`agentos_*`) rather than guessing the shape of an existing production schema. Before production application, map `principal_id` to the existing identity table and either retain or replace the namespaced tenant/project tables through an approved compatibility migration.

The migration requires PostgreSQL with `pgcrypto` available. It must be applied in a transaction by a migration runner that records the migration version. Do not run the down migration in production without an approved data-retention and backup decision.

## Required application checks

The database constraints are necessary but not sufficient. Channel services must derive `tenant_id`, `mesh_group_id`, `site_id`, and `principal_id` from the authenticated server context. They must verify tenant membership, mesh-group membership, site membership, role, permission, approval, and device state before mutations. Chat IDs, phone numbers, usernames, project labels, site labels, and router IP addresses are not authorization claims.

## Suggested verification

1. Apply the up migration to an isolated PostgreSQL database.
2. Insert two tenants and one user in each tenant.
3. Verify that a project, mesh group, site, node, or edge cannot reference a different tenant through composite foreign keys.
4. Verify that the partial unique index prevents a second active mesh group for one tenant.
5. Verify that a node cannot attach to a site in another mesh group.
6. Verify that an edge cannot connect nodes from different mesh groups.
7. Run the down migration only against disposable test data and confirm all objects are removed.
