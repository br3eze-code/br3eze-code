-- AgentOS tenant-scoped mesh management
-- PostgreSQL 15+
--
-- Scope:
--   tenant -> tenant_user / tenant_project -> mesh_group -> site -> mesh_node -> mesh_edge
--
-- This migration intentionally uses a canonical tenant_user and tenant_project
-- registry so channel identities and project records cannot bypass tenant scope.
-- Apply inside one transaction in the deployment migration runner.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE agentos_tenant_status AS ENUM ('pending', 'active', 'suspended', 'closed');
CREATE TYPE agentos_membership_status AS ENUM ('invited', 'active', 'suspended', 'removed');
CREATE TYPE agentos_mesh_status AS ENUM ('provisioning', 'active', 'suspended', 'retired');
CREATE TYPE agentos_site_status AS ENUM ('pending', 'active', 'suspended', 'retired');
CREATE TYPE agentos_node_status AS ENUM ('enrolling', 'online', 'offline', 'quarantined', 'suspended', 'retired');
CREATE TYPE agentos_edge_status AS ENUM ('proposed', 'up', 'degraded', 'down', 'retired');

CREATE TABLE agentos_tenants (
  tenant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status agentos_tenant_status NOT NULL DEFAULT 'pending',
  plan_code text NOT NULL DEFAULT 'standard',
  max_mesh_groups integer NOT NULL DEFAULT 1 CHECK (max_mesh_groups > 0),
  created_by_principal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agentos_tenant_users (
  tenant_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer', 'auditor', 'billing', 'contractor')),
  status agentos_membership_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, principal_id),
  CONSTRAINT fk_tenant_user_tenant
    FOREIGN KEY (tenant_id) REFERENCES agentos_tenants (tenant_id) ON DELETE CASCADE
);

CREATE TABLE agentos_tenant_projects (
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended', 'closed')),
  created_by_principal_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id),
  UNIQUE (tenant_id, project_key),
  CONSTRAINT fk_project_tenant
    FOREIGN KEY (tenant_id) REFERENCES agentos_tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_project_creator_tenant_user
    FOREIGN KEY (tenant_id, created_by_principal_id)
    REFERENCES agentos_tenant_users (tenant_id, principal_id)
);

CREATE TABLE agentos_mesh_groups (
  tenant_id uuid NOT NULL,
  mesh_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid,
  mesh_key text NOT NULL,
  display_name text NOT NULL,
  status agentos_mesh_status NOT NULL DEFAULT 'provisioning',
  created_by_principal_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, mesh_group_id),
  UNIQUE (tenant_id, mesh_key),
  CONSTRAINT fk_mesh_tenant
    FOREIGN KEY (tenant_id) REFERENCES agentos_tenants (tenant_id) ON DELETE CASCADE,
  CONSTRAINT fk_mesh_project_same_tenant
    FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_tenant_projects (tenant_id, project_id),
  CONSTRAINT fk_mesh_creator_same_tenant
    FOREIGN KEY (tenant_id, created_by_principal_id)
    REFERENCES agentos_tenant_users (tenant_id, principal_id)
);

CREATE UNIQUE INDEX uq_one_active_mesh_group_per_tenant
  ON agentos_mesh_groups (tenant_id)
  WHERE status IN ('provisioning', 'active', 'suspended');

CREATE TABLE agentos_mesh_group_users (
  tenant_id uuid NOT NULL,
  mesh_group_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('mesh_admin', 'site_admin', 'operator', 'viewer', 'auditor')),
  status agentos_membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, mesh_group_id, principal_id),
  CONSTRAINT fk_mesh_user_mesh_same_tenant
    FOREIGN KEY (tenant_id, mesh_group_id)
    REFERENCES agentos_mesh_groups (tenant_id, mesh_group_id) ON DELETE CASCADE,
  CONSTRAINT fk_mesh_user_membership_same_tenant
    FOREIGN KEY (tenant_id, principal_id)
    REFERENCES agentos_tenant_users (tenant_id, principal_id) ON DELETE CASCADE
);

CREATE TABLE agentos_sites (
  tenant_id uuid NOT NULL,
  mesh_group_id uuid NOT NULL,
  site_id uuid NOT NULL DEFAULT gen_random_uuid(),
  site_key text NOT NULL,
  display_name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  status agentos_site_status NOT NULL DEFAULT 'pending',
  created_by_principal_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id),
  UNIQUE (tenant_id, mesh_group_id, site_id),
  UNIQUE (tenant_id, mesh_group_id, site_key),
  CONSTRAINT fk_site_mesh_same_tenant
    FOREIGN KEY (tenant_id, mesh_group_id)
    REFERENCES agentos_mesh_groups (tenant_id, mesh_group_id) ON DELETE CASCADE,
  CONSTRAINT fk_site_creator_same_tenant
    FOREIGN KEY (tenant_id, created_by_principal_id)
    REFERENCES agentos_tenant_users (tenant_id, principal_id)
);

CREATE TABLE agentos_site_users (
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('site_admin', 'operator', 'viewer', 'auditor')),
  status agentos_membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, site_id, principal_id),
  CONSTRAINT fk_site_user_site_same_tenant
    FOREIGN KEY (tenant_id, site_id)
    REFERENCES agentos_sites (tenant_id, site_id) ON DELETE CASCADE,
  CONSTRAINT fk_site_user_membership_same_tenant
    FOREIGN KEY (tenant_id, principal_id)
    REFERENCES agentos_tenant_users (tenant_id, principal_id) ON DELETE CASCADE
);

CREATE TABLE agentos_mesh_nodes (
  tenant_id uuid NOT NULL,
  mesh_group_id uuid NOT NULL,
  site_id uuid NOT NULL,
  node_id uuid NOT NULL DEFAULT gen_random_uuid(),
  node_key text NOT NULL,
  node_type text NOT NULL CHECK (node_type IN ('mikrotik', 'starlink', 'cctv_gateway', 'relay', 'agent', 'service')),
  display_name text NOT NULL,
  status agentos_node_status NOT NULL DEFAULT 'enrolling',
  fingerprint_hash bytea,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, node_id),
  UNIQUE (tenant_id, mesh_group_id, node_id),
  UNIQUE (tenant_id, mesh_group_id, site_id, node_key),
  CONSTRAINT fk_node_site_same_mesh
    FOREIGN KEY (tenant_id, site_id)
    REFERENCES agentos_sites (tenant_id, site_id) ON DELETE CASCADE,
  CONSTRAINT fk_node_mesh_same_tenant
    FOREIGN KEY (tenant_id, mesh_group_id)
    REFERENCES agentos_mesh_groups (tenant_id, mesh_group_id) ON DELETE CASCADE,
  CONSTRAINT fk_node_site_mesh_consistency
    FOREIGN KEY (tenant_id, mesh_group_id, site_id)
    REFERENCES agentos_sites (tenant_id, mesh_group_id, site_id)
);

CREATE UNIQUE INDEX uq_node_fingerprint_per_tenant
  ON agentos_mesh_nodes (tenant_id, fingerprint_hash)
  WHERE fingerprint_hash IS NOT NULL;

CREATE TABLE agentos_mesh_edges (
  tenant_id uuid NOT NULL,
  mesh_group_id uuid NOT NULL,
  edge_id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL,
  to_node_id uuid NOT NULL,
  edge_type text NOT NULL CHECK (edge_type IN ('wireguard', 'ethernet', 'wireless', 'api', 'tunnel', 'logical')),
  status agentos_edge_status NOT NULL DEFAULT 'proposed',
  observed_at timestamptz,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, edge_id),
  CONSTRAINT chk_edge_distinct_nodes CHECK (from_node_id <> to_node_id),
  CONSTRAINT fk_edge_from_node_same_mesh
    FOREIGN KEY (tenant_id, mesh_group_id, from_node_id)
    REFERENCES agentos_mesh_nodes (tenant_id, mesh_group_id, node_id) ON DELETE CASCADE,
  CONSTRAINT fk_edge_to_node_same_mesh
    FOREIGN KEY (tenant_id, mesh_group_id, to_node_id)
    REFERENCES agentos_mesh_nodes (tenant_id, mesh_group_id, node_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_mesh_edge_direction
  ON agentos_mesh_edges (tenant_id, mesh_group_id, from_node_id, to_node_id, edge_type)
  WHERE status <> 'retired';

CREATE INDEX idx_tenant_users_principal ON agentos_tenant_users (principal_id, status);
CREATE INDEX idx_projects_tenant_status ON agentos_tenant_projects (tenant_id, status);
CREATE INDEX idx_mesh_groups_tenant_status ON agentos_mesh_groups (tenant_id, status);
CREATE INDEX idx_sites_mesh_status ON agentos_sites (tenant_id, mesh_group_id, status);
CREATE INDEX idx_nodes_site_status ON agentos_mesh_nodes (tenant_id, site_id, status);
CREATE INDEX idx_edges_mesh_status ON agentos_mesh_edges (tenant_id, mesh_group_id, status);

-- Transaction-scoped application context. The adapter sets these values with
-- set_config(..., true) at the start of every transaction.
CREATE OR REPLACE FUNCTION agentos_current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION agentos_current_principal_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.principal_id', true), '')::uuid
$$;

-- RLS is a tenant boundary backstop. Service-layer role and site-membership
-- checks remain mandatory before mutation execution.
ALTER TABLE agentos_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_tenant_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_group_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_site_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_edges ENABLE ROW LEVEL SECURITY;

ALTER TABLE agentos_tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_tenant_users FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_tenant_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_group_users FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_sites FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_site_users FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE agentos_mesh_edges FORCE ROW LEVEL SECURITY;

CREATE POLICY agentos_tenant_scope ON agentos_tenants
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_tenant_user_scope ON agentos_tenant_users
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_project_scope ON agentos_tenant_projects
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_mesh_scope ON agentos_mesh_groups
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_mesh_user_scope ON agentos_mesh_group_users
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_site_scope ON agentos_sites
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_site_user_scope ON agentos_site_users
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_node_scope ON agentos_mesh_nodes
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());
CREATE POLICY agentos_edge_scope ON agentos_mesh_edges
  USING (tenant_id = agentos_current_tenant_id())
  WITH CHECK (tenant_id = agentos_current_tenant_id());

-- Keep updated_at consistent without requiring application code to do so.
CREATE OR REPLACE FUNCTION agentos_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_updated_at BEFORE UPDATE ON agentos_tenants
FOR EACH ROW EXECUTE FUNCTION agentos_set_updated_at();
CREATE TRIGGER trg_tenant_user_updated_at BEFORE UPDATE ON agentos_tenant_users
FOR EACH ROW EXECUTE FUNCTION agentos_set_updated_at();
CREATE TRIGGER trg_project_updated_at BEFORE UPDATE ON agentos_tenant_projects
FOR EACH ROW EXECUTE FUNCTION agentos_set_updated_at();
CREATE TRIGGER trg_mesh_updated_at BEFORE UPDATE ON agentos_mesh_groups
FOR EACH ROW EXECUTE FUNCTION agentos_set_updated_at();
CREATE TRIGGER trg_site_updated_at BEFORE UPDATE ON agentos_sites
FOR EACH ROW EXECUTE FUNCTION agentos_set_updated_at();
CREATE TRIGGER trg_node_updated_at BEFORE UPDATE ON agentos_mesh_nodes
FOR EACH ROW EXECUTE FUNCTION agentos_set_updated_at();
CREATE TRIGGER trg_edge_updated_at BEFORE UPDATE ON agentos_mesh_edges
FOR EACH ROW EXECUTE FUNCTION agentos_set_updated_at();

COMMIT;
