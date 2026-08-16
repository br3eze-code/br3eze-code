import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WbsService } from '../../src/core/wbs-service.js';
import { ProjectManagerCoordinator } from '../../src/core/project-manager-coordinator.js';

describe('Project Manager coordinator and durable WBS service', () => {
  let directory;
  let file;
  let context;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-wbs-'));
    file = path.join(directory, 'wbs.json');
    context = { tenantId: 'tenant-a', siteId: 'site-a', userId: 'pm-a', domain: 'general' };
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('creates a project and seeds all professional work packages', async () => {
    const service = new WbsService({ forceFile: true, fallbackPath: file });
    const coordinator = new ProjectManagerCoordinator({ wbsService: service });
    const result = await coordinator.createProject({ context, name: 'Cross-domain rollout' });

    expect(result.project.tenantId).toBe('tenant-a');
    expect(result.packages.length).toBeGreaterThanOrEqual(40);
    expect(new Set(result.packages.map((item) => item.agentRole))).toEqual(new Set(['planner', 'engineer', 'accountant', 'secretary', 'procurement', 'expeditor', 'designer', 'draftsman', 'qa']));
    expect(result.packages.filter((item) => item.status === 'ready').length).toBe(9);
  });

  test('persists packages across service instances', async () => {
    const first = new WbsService({ forceFile: true, fallbackPath: file });
    const coordinator = new ProjectManagerCoordinator({ wbsService: first });
    const { project } = await coordinator.createProject({ context, name: 'Persistent plan' });

    const second = new WbsService({ forceFile: true, fallbackPath: file });
    const plan = await new ProjectManagerCoordinator({ wbsService: second }).getProjectPlan({ ...context, projectId: project.projectId });
    expect(plan.projects[0].projectId).toBe(project.projectId);
    expect(plan.packages.every((item) => item.projectId === project.projectId)).toBe(true);
  });

  test('does not expose another tenant project or package', async () => {
    const service = new WbsService({ forceFile: true, fallbackPath: file });
    const coordinator = new ProjectManagerCoordinator({ wbsService: service });
    await coordinator.createProject({ context, name: 'Tenant A project' });
    await coordinator.createProject({ context: { ...context, tenantId: 'tenant-b', siteId: 'site-b', userId: 'pm-b' }, name: 'Tenant B project' });

    const plan = await coordinator.getProjectPlan({ ...context, projectId: null });
    expect(plan.projects.every((item) => item.tenantId === 'tenant-a')).toBe(true);
    expect(plan.packages.every((item) => item.tenantId === 'tenant-a')).toBe(true);
  });

  test('calculates next actions and blocks approval-gated acceptance', async () => {
    const service = new WbsService({ forceFile: true, fallbackPath: file });
    const coordinator = new ProjectManagerCoordinator({ wbsService: service });
    const { project } = await coordinator.createProject({ context, name: 'Approval plan' });
    const packages = await service.listPackages({ ...context, projectId: project.projectId });
    const first = packages.find((item) => item.requiresApproval);

    await coordinator.transitionPackage({ wbsId: first.wbsId, status: 'ready', context: { ...context, projectId: project.projectId } });
    await coordinator.transitionPackage({ wbsId: first.wbsId, status: 'in_progress', context: { ...context, projectId: project.projectId } });
    await coordinator.transitionPackage({ wbsId: first.wbsId, status: 'review', context: { ...context, projectId: project.projectId } });
    const blocked = await coordinator.transitionPackage({ wbsId: first.wbsId, status: 'accepted', context: { ...context, projectId: project.projectId } });
    expect(blocked.status).toBe('approval_required');
    expect(coordinator.getNextActions(packages).length).toBeGreaterThan(0);
  });

  test('only the owning role can receive a handoff', async () => {
    const service = new WbsService({ forceFile: true, fallbackPath: file });
    const coordinator = new ProjectManagerCoordinator({ wbsService: service });
    const { project } = await coordinator.createProject({ context, name: 'Handoff plan' });
    const packages = await service.listPackages({ ...context, projectId: project.projectId });
    const engineering = packages.find((item) => item.agentRole === 'engineer');

    await expect(coordinator.proposeHandoff({ wbsId: engineering.wbsId, fromRole: 'planner', toRole: 'accountant', context: { ...context, projectId: project.projectId } })).rejects.toThrow('does not own');
    const handoff = await coordinator.proposeHandoff({ wbsId: engineering.wbsId, fromRole: 'planner', toRole: 'engineer', context: { ...context, projectId: project.projectId } });
    expect(handoff.toRole).toBe('engineer');
  });
});
