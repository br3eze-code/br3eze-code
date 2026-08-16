import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const migrationPath = new URL('../migrations/001_project_manager_commercial.sql', import.meta.url);
const migration = fs.readFileSync(migrationPath, 'utf8');
const dbPath = path.join(os.tmpdir(), `agentos-pm-schema-${process.pid}.sqlite`);
const db = new Database(dbPath);

try {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE agentos_projects (
      projectId TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      siteId TEXT,
      domain TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      ownerUserId TEXT NOT NULL,
      metadata TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  db.exec(migration);

  const insertProject = db.prepare(`INSERT INTO agentos_projects
    (projectId, tenantId, siteId, domain, name, status, ownerUserId, metadata, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, '{}', datetime('now'), datetime('now'))`);
  insertProject.run('p-a', 'tenant-a', null, 'general', 'A', 'active', 'u-a');
  insertProject.run('p-b', 'tenant-b', null, 'general', 'B', 'active', 'u-b');

  const insertWbs = db.prepare(`INSERT INTO pm_wbs_packages
    (wbs_id, tenant_id, project_id, package_code, agent_role, title, objective, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`);
  insertWbs.run('w-a', 'tenant-a', 'p-a', 'A-001', 'planner', 'Plan A', 'Plan A');
  insertWbs.run('w-b', 'tenant-b', 'p-b', 'B-001', 'planner', 'Plan B', 'Plan B');

  let rejected = false;
  try {
    insertWbs.run('w-cross', 'tenant-a', 'p-b', 'X-001', 'planner', 'Cross', 'Should fail');
  } catch (error) {
    rejected = /FOREIGN KEY/i.test(error.message);
  }
  if (!rejected) throw new Error('Cross-tenant project reference was not rejected');

  const insertDependency = db.prepare(`INSERT INTO pm_wbs_dependencies
    (tenant_id, wbs_id, depends_on_wbs_id, created_at)
    VALUES (?, ?, ?, datetime('now'))`);
  insertDependency.run('tenant-a', 'w-a', 'w-a');
  throw new Error('Self dependency was not rejected');
} catch (error) {
  if (error.message === 'Self dependency was not rejected') throw error;
  if (!/CHECK constraint failed: wbs_id <> depends_on_wbs_id/i.test(error.message)) throw error;
} finally {
  db.close();
  fs.rmSync(dbPath, { force: true });
}

console.log('Project Manager schema validation passed');
