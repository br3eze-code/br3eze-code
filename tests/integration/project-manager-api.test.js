import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WbsService } from '../../src/core/wbs-service.js';
import { ProjectManagerCoordinator } from '../../src/core/project-manager-coordinator.js';
import { createProjectManagerRouter } from '../../src/api/routes/project-manager.js';

function makeApp(identity, coordinator) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (identity !== undefined) req.firebaseUser = identity;
    next();
  });
  app.use('/api/v1/project-manager', createProjectManagerRouter({ coordinator }));
  return app;
}

describe('Project Manager API tenant isolation', () => {
  let directory;
  let file;
  let service;
  let coordinator;
  let tenantA;
  let tenantB;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-pm-api-'));
    file = path.join(directory, 'wbs.json');
    service = new WbsService({ forceFile: true, fallbackPath: file });
    coordinator = new ProjectManagerCoordinator({ wbsService: service });
    tenantA = { uid: 'pm-a', userId: 'pm-a', role: 'project_manager', tenantId: 'tenant-a', siteId: 'site-a', domainId: 'general' };
    tenantB = { uid: 'pm-b', userId: 'pm-b', role: 'project_manager', tenantId: 'tenant-b', siteId: 'site-b', domainId: 'general' };
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('rejects requests without a verified identity even when scope headers are supplied', async () => {
    const response = await request(makeApp(undefined, coordinator))
      .get('/api/v1/project-manager/projects')
      .set('x-agentos-tenant-id', 'tenant-a')
      .set('x-agentos-role', 'project_manager');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('IDENTITY_REQUIRED');
  });

  test('rejects a non-manager identity before reading any WBS state', async () => {
    const response = await request(makeApp({ ...tenantA, role: 'engineer' }, coordinator))
      .get('/api/v1/project-manager/projects');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PROJECT_MANAGER_ROLE_REQUIRED');
  });

  test('lists only projects and packages belonging to the caller tenant', async () => {
    const projectA = await request(makeApp(tenantA, coordinator))
      .post('/api/v1/project-manager/projects').send({ name: 'A project' });
    const projectB = await request(makeApp(tenantB, coordinator))
      .post('/api/v1/project-manager/projects').send({ name: 'B project' });
    expect(projectA.status).toBe(201);
    expect(projectB.status).toBe(201);

    const response = await request(makeApp(tenantA, coordinator))
      .get('/api/v1/project-manager/projects');
    expect(response.status).toBe(200);
    expect(response.body.data.projects).toHaveLength(1);
    expect(response.body.data.projects[0].tenantId).toBe('tenant-a');
    expect(response.body.data.packages.every((item) => item.tenantId === 'tenant-a')).toBe(true);
  });

  test('rejects a package transition when the project belongs to another tenant', async () => {
    const created = await coordinator.createProject({ context: tenantA, name: 'Private project' });
    const packageId = created.packages[0].wbsId;
    const response = await request(makeApp(tenantB, coordinator))
      .post(`/api/v1/project-manager/packages/${packageId}/transition`)
      .send({ projectId: created.project.projectId, status: 'in_progress' });
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('WBS_PACKAGE_NOT_FOUND');
  });

  test('rejects a cross-tenant handoff even when the caller knows the WBS ID', async () => {
    const created = await coordinator.createProject({ context: tenantA, name: 'Private handoff project' });
    const packageId = created.packages.find((item) => item.agentRole === 'engineer').wbsId;
    const response = await request(makeApp(tenantB, coordinator))
      .post('/api/v1/project-manager/handoffs')
      .send({ projectId: created.project.projectId, wbsId: packageId, fromRole: 'planner', toRole: 'engineer' });
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('WBS_PACKAGE_NOT_FOUND');
  });

  test('requires explicit approval before accepting an approval-gated package', async () => {
    const created = await coordinator.createProject({ context: tenantA, name: 'Approval project' });
    const packageId = created.packages.find((item) => item.requiresApproval).wbsId;
    const app = makeApp(tenantA, coordinator);
    await request(app).post(`/api/v1/project-manager/packages/${packageId}/transition`).send({ projectId: created.project.projectId, status: 'ready' });
    await request(app).post(`/api/v1/project-manager/packages/${packageId}/transition`).send({ projectId: created.project.projectId, status: 'in_progress' });
    await request(app).post(`/api/v1/project-manager/packages/${packageId}/transition`).send({ projectId: created.project.projectId, status: 'review' });
    const blocked = await request(app).post(`/api/v1/project-manager/packages/${packageId}/transition`).send({ projectId: created.project.projectId, status: 'accepted' });
    expect(blocked.status).toBe(200);
    expect(blocked.body.data.status).toBe('approval_required');
  });
});
