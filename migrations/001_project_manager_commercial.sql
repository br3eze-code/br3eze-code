-- AgentOS Project Manager commercial schema
-- PostgreSQL and SQLite compatible SQL.
-- SQLite callers MUST execute: PRAGMA foreign_keys = ON;

-- Existing AgentOS projects are upgraded with a tenant/project composite key so
-- child records cannot reference a project belonging to another tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agentos_projects_tenant_project
  ON agentos_projects (tenantId, projectId);

CREATE TABLE IF NOT EXISTS pm_wbs_packages (
  wbs_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  site_id TEXT,
  domain TEXT NOT NULL DEFAULT 'general',
  parent_wbs_id TEXT,
  package_code TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  owner_user_id TEXT,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','ready','in_progress','blocked','review','accepted','rejected','closed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  requires_approval INTEGER NOT NULL DEFAULT 0
    CHECK (requires_approval IN (0,1)),
  currency TEXT NOT NULL DEFAULT 'USD',
  budget_approved NUMERIC NOT NULL DEFAULT 0 CHECK (budget_approved >= 0),
  budget_committed NUMERIC NOT NULL DEFAULT 0 CHECK (budget_committed >= 0),
  budget_actual NUMERIC NOT NULL DEFAULT 0 CHECK (budget_actual >= 0),
  budget_forecast NUMERIC NOT NULL DEFAULT 0 CHECK (budget_forecast >= 0),
  qa_gate TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, wbs_id),
  UNIQUE (tenant_id, project_id, package_code),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_projects (tenantId, projectId)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, parent_wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pm_wbs_dependencies (
  tenant_id TEXT NOT NULL,
  wbs_id TEXT NOT NULL,
  depends_on_wbs_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, wbs_id, depends_on_wbs_id),
  CHECK (wbs_id <> depends_on_wbs_id),
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, depends_on_wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pm_wbs_items (
  item_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  wbs_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('deliverable','acceptance_criterion','evidence_requirement')),
  ordinal INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  description TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','met','waived','rejected')),
  evidence_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, item_id),
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pm_subcontractors (
  subcontractor_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  display_name TEXT,
  contact_ref TEXT,
  tax_reference TEXT,
  status TEXT NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect','approved','suspended','inactive')),
  commission_rate NUMERIC CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1)),
  currency TEXT NOT NULL DEFAULT 'USD',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, subcontractor_id),
  UNIQUE (tenant_id, legal_name)
);

CREATE TABLE IF NOT EXISTS pm_subcontracts (
  subcontract_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  wbs_id TEXT NOT NULL,
  subcontractor_id TEXT NOT NULL,
  site_id TEXT,
  domain TEXT NOT NULL DEFAULT 'general',
  contract_type TEXT NOT NULL CHECK (contract_type IN ('fixed_price','time_and_materials','commission','framework','purchase_order')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','proposed','approved','active','suspended','completed','terminated','closed')),
  currency TEXT NOT NULL DEFAULT 'USD',
  contract_value NUMERIC NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  approved_variations NUMERIC NOT NULL DEFAULT 0 CHECK (approved_variations >= 0),
  commission_rate NUMERIC CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 1)),
  start_at TEXT,
  planned_finish_at TEXT,
  actual_finish_at TEXT,
  terms_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, subcontract_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_projects (tenantId, projectId)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, subcontractor_id)
    REFERENCES pm_subcontractors (tenant_id, subcontractor_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pm_subcontract_milestones (
  milestone_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subcontract_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  due_at TEXT,
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','submitted','accepted','rejected','paid')),
  acceptance_evidence_ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, milestone_id),
  FOREIGN KEY (tenant_id, subcontract_id)
    REFERENCES pm_subcontracts (tenant_id, subcontract_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pm_pro_formas (
  proforma_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  wbs_id TEXT,
  subcontract_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','superseded','rejected')),
  currency TEXT NOT NULL DEFAULT 'USD',
  normal_duration_days INTEGER CHECK (normal_duration_days IS NULL OR normal_duration_days >= 0),
  target_duration_days INTEGER CHECK (target_duration_days IS NULL OR target_duration_days >= 0),
  crash_duration_days INTEGER CHECK (crash_duration_days IS NULL OR crash_duration_days >= 0),
  revenue_quoted NUMERIC NOT NULL DEFAULT 0 CHECK (revenue_quoted >= 0),
  gross_margin NUMERIC,
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, proforma_id),
  UNIQUE (tenant_id, project_id, version),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_projects (tenantId, projectId)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, subcontract_id)
    REFERENCES pm_subcontracts (tenant_id, subcontract_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pm_pro_forma_lines (
  line_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  proforma_id TEXT NOT NULL,
  wbs_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('materials','labour','subcontract','transport','testing','commission','contingency','other')),
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  unit_cost NUMERIC NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  normal_cost NUMERIC NOT NULL DEFAULT 0 CHECK (normal_cost >= 0),
  target_cost NUMERIC NOT NULL DEFAULT 0 CHECK (target_cost >= 0),
  crash_cost NUMERIC NOT NULL DEFAULT 0 CHECK (crash_cost >= 0),
  committed_cost NUMERIC NOT NULL DEFAULT 0 CHECK (committed_cost >= 0),
  actual_cost NUMERIC NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),
  forecast_cost NUMERIC NOT NULL DEFAULT 0 CHECK (forecast_cost >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, line_id),
  FOREIGN KEY (tenant_id, proforma_id)
    REFERENCES pm_pro_formas (tenant_id, proforma_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pm_change_logs (
  change_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_by_type TEXT NOT NULL CHECK (requested_by_type IN ('user','agent','subcontractor','system')),
  status TEXT NOT NULL DEFAULT 'identified'
    CHECK (status IN ('identified','impact_assessed','priced','technically_reviewed','commercially_reviewed','approved','rejected','implemented','tested','commissioned','cancelled')),
  reason TEXT NOT NULL,
  baseline_scope TEXT NOT NULL,
  proposed_scope TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  direct_cost NUMERIC NOT NULL DEFAULT 0 CHECK (direct_cost >= 0),
  design_cost NUMERIC NOT NULL DEFAULT 0 CHECK (design_cost >= 0),
  procurement_cost NUMERIC NOT NULL DEFAULT 0 CHECK (procurement_cost >= 0),
  schedule_cost NUMERIC NOT NULL DEFAULT 0 CHECK (schedule_cost >= 0),
  testing_cost NUMERIC NOT NULL DEFAULT 0 CHECK (testing_cost >= 0),
  rework_cost NUMERIC NOT NULL DEFAULT 0 CHECK (rework_cost >= 0),
  revenue_impact NUMERIC NOT NULL DEFAULT 0,
  time_impact_days NUMERIC NOT NULL DEFAULT 0,
  risk_impact TEXT,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  implemented_at TEXT,
  UNIQUE (tenant_id, change_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_projects (tenantId, projectId)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pm_change_wbs (
  tenant_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  wbs_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, change_id, wbs_id),
  FOREIGN KEY (tenant_id, change_id)
    REFERENCES pm_change_logs (tenant_id, change_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pm_approvals (
  approval_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  wbs_id TEXT,
  change_id TEXT,
  subcontract_id TEXT,
  approval_type TEXT NOT NULL CHECK (approval_type IN ('scope','budget','subcontract','purchase','change','qa','commissioning','payment')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','revoked','expired')),
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  reason TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  UNIQUE (tenant_id, approval_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_projects (tenantId, projectId)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, change_id)
    REFERENCES pm_change_logs (tenant_id, change_id)
    ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, subcontract_id)
    REFERENCES pm_subcontracts (tenant_id, subcontract_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pm_evidence (
  evidence_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  wbs_id TEXT,
  subcontract_id TEXT,
  change_id TEXT,
  approval_id TEXT,
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('quote','invoice','drawing','test','inspection','photo','message','approval','receipt','other')),
  source_ref TEXT NOT NULL,
  content_hash TEXT,
  captured_by TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, evidence_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_projects (tenantId, projectId)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, wbs_id)
    REFERENCES pm_wbs_packages (tenant_id, wbs_id)
    ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, subcontract_id)
    REFERENCES pm_subcontracts (tenant_id, subcontract_id)
    ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, change_id)
    REFERENCES pm_change_logs (tenant_id, change_id)
    ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, approval_id)
    REFERENCES pm_approvals (tenant_id, approval_id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pm_change_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','subcontractor','system')),
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, project_id)
    REFERENCES agentos_projects (tenantId, projectId)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pm_wbs_scope
  ON pm_wbs_packages (tenant_id, project_id, site_id, domain, status);
CREATE INDEX IF NOT EXISTS idx_pm_wbs_owner
  ON pm_wbs_packages (tenant_id, owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_dependencies_target
  ON pm_wbs_dependencies (tenant_id, depends_on_wbs_id);
CREATE INDEX IF NOT EXISTS idx_pm_subcontracts_scope
  ON pm_subcontracts (tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_proformas_scope
  ON pm_pro_formas (tenant_id, project_id, status, version);
CREATE INDEX IF NOT EXISTS idx_pm_changes_scope
  ON pm_change_logs (tenant_id, project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_pm_approvals_scope
  ON pm_approvals (tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_pm_evidence_scope
  ON pm_evidence (tenant_id, project_id, wbs_id, change_id);
CREATE INDEX IF NOT EXISTS idx_pm_events_entity
  ON pm_change_events (tenant_id, project_id, entity_type, entity_id, created_at);
