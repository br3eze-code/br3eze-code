-- Roll back 001_tenant_mesh_groups.up.sql.
-- Run only after confirming no production records depend on these tables.

BEGIN;

DROP TRIGGER IF EXISTS trg_edge_updated_at ON agentos_mesh_edges;
DROP TRIGGER IF EXISTS trg_node_updated_at ON agentos_mesh_nodes;
DROP TRIGGER IF EXISTS trg_site_updated_at ON agentos_sites;
DROP TRIGGER IF EXISTS trg_mesh_updated_at ON agentos_mesh_groups;
DROP TRIGGER IF EXISTS trg_project_updated_at ON agentos_tenant_projects;
DROP TRIGGER IF EXISTS trg_tenant_user_updated_at ON agentos_tenant_users;
DROP TRIGGER IF EXISTS trg_tenant_updated_at ON agentos_tenants;

DROP TABLE IF EXISTS agentos_mesh_edges;
DROP TABLE IF EXISTS agentos_mesh_nodes;
DROP TABLE IF EXISTS agentos_site_users;
DROP TABLE IF EXISTS agentos_sites;
DROP TABLE IF EXISTS agentos_mesh_group_users;
DROP TABLE IF EXISTS agentos_mesh_groups;
DROP TABLE IF EXISTS agentos_tenant_projects;
DROP TABLE IF EXISTS agentos_tenant_users;
DROP TABLE IF EXISTS agentos_tenants;

DROP FUNCTION IF EXISTS agentos_set_updated_at();

DROP TYPE IF EXISTS agentos_edge_status;
DROP TYPE IF EXISTS agentos_node_status;
DROP TYPE IF EXISTS agentos_site_status;
DROP TYPE IF EXISTS agentos_mesh_status;
DROP TYPE IF EXISTS agentos_membership_status;
DROP TYPE IF EXISTS agentos_tenant_status;

COMMIT;
