import { instantiateWorkPackages } from './wbs-work-packages.js';

const PROFESSIONAL_ROLES = Object.freeze(['planner', 'engineer', 'accountant', 'secretary', 'procurement', 'expeditor', 'designer', 'draftsman', 'qa']);

function requireScope(context = {}) {
  if (!context.tenantId) throw new Error('tenantId is required for project coordination');
  if (!context.userId) throw new Error('userId is required for project coordination');
}

function notFound(message = 'WBS package not found') {
  return Object.assign(new Error(message), { status: 404, code: 'WBS_PACKAGE_NOT_FOUND' });
}

function canTransition(current, next) {
  const allowed = {
    proposed: ['ready', 'blocked'],
    ready: ['in_progress', 'blocked'],
    in_progress: ['review', 'blocked', 'ready'],
    blocked: ['ready', 'in_progress'],
    review: ['accepted', 'rejected', 'blocked'],
    rejected: ['ready', 'blocked'],
    accepted: ['closed'],
    closed: []
  };
  return Boolean(allowed[current]?.includes(next));
}

export class ProjectManagerCoordinator {
  constructor({ wbsService, now = () => new Date().toISOString() } = {}) {
    if (!wbsService) throw new Error('wbsService is required');
    this.wbs = wbsService;
    this.now = now;
  }

  async createProject({ context = {}, name, projectId = null, domain = context.domain || 'general', roles = PROFESSIONAL_ROLES, metadata = {} } = {}) {
    requireScope(context);
    const project = await this.wbs.createProject({ projectId, name, domain, metadata, tenantId: context.tenantId, siteId: context.siteId, userId: context.userId });
    const packages = roles.flatMap((role) => instantiateWorkPackages(role, { ...context, domain, projectId: project.projectId }, { projectId: project.projectId }));
    await this.wbs.savePackages(packages, { ...context, projectId: project.projectId, domain });
    return { project, packages };
  }

  async getProjectPlan(context = {}) {
    requireScope(context);
    const projects = await this.wbs.listProjects(context);
    const packages = await this.wbs.listPackages(context);
    const handoffs = await this.wbs.listHandoffs(context);
    return { projects, packages, handoffs, criticalPath: this.findCriticalPath(packages), nextActions: this.getNextActions(packages) };
  }

  findCriticalPath(packages = []) {
    const byId = new Map(packages.map((item) => [item.wbsId, item]));
    const depth = new Map();
    const visit = (item, stack = new Set()) => {
      if (depth.has(item.wbsId)) return depth.get(item.wbsId);
      if (stack.has(item.wbsId)) throw new Error(`WBS dependency cycle detected at ${item.wbsId}`);
      const nextStack = new Set(stack).add(item.wbsId);
      const value = 1 + Math.max(0, ...(item.dependencies || []).map((dependency) => byId.has(dependency) ? visit(byId.get(dependency), nextStack) : 0));
      depth.set(item.wbsId, value);
      return value;
    };
    packages.forEach((item) => visit(item));
    const maxDepth = Math.max(0, ...depth.values());
    return packages.filter((item) => depth.get(item.wbsId) === maxDepth).map((item) => item.wbsId);
  }

  getNextActions(packages = []) {
    const completed = new Set(packages.filter((item) => ['accepted', 'closed'].includes(item.status)).map((item) => item.wbsId));
    return packages.filter((item) => ['ready', 'proposed'].includes(item.status) && (item.dependencies || []).every((dependency) => completed.has(dependency) || !packages.some((candidate) => candidate.wbsId === dependency))).slice(0, 12).map((item) => ({ wbsId: item.wbsId, agentRole: item.agentRole, title: item.title, requiresApproval: item.requiresApproval }));
  }

  async transitionPackage({ wbsId, status, context = {}, evidenceRefs, reason } = {}) {
    requireScope(context);
    const packages = await this.wbs.listPackages({ ...context, projectId: context.projectId || null });
    const current = packages.find((item) => item.wbsId === wbsId);
    if (!current) throw notFound(`WBS package not found: ${wbsId}`);
    if (!canTransition(current.status, status)) throw new Error(`Invalid WBS transition ${current.status} -> ${status}`);
    const approvalRequired = current.requiresApproval && ['accepted', 'closed'].includes(status);
    if (approvalRequired && context.approvalGranted !== true) return { status: 'approval_required', wbsId, requestedStatus: status, agentRole: current.agentRole };
    return this.wbs.updatePackage(wbsId, { status, evidenceRefs: evidenceRefs || current.evidenceRefs, transitionReason: reason || null, transitionedAt: this.now() }, context);
  }

  async proposeHandoff({ wbsId, fromRole, toRole, context = {}, payload = {}, toUserId = null } = {}) {
    requireScope(context);
    if (!PROFESSIONAL_ROLES.includes(fromRole) || !PROFESSIONAL_ROLES.includes(toRole)) throw new Error('Unsupported professional role in handoff');
    const packages = await this.wbs.listPackages({ ...context, projectId: context.projectId || null });
    const target = packages.find((item) => item.wbsId === wbsId);
    if (!target) throw notFound(`WBS package not found: ${wbsId}`);
    if (target.agentRole !== toRole) throw new Error('Handoff target role does not own the WBS package');
    return this.wbs.createHandoff({ ...context, projectId: target.projectId, wbsId, fromRole, toRole, toUserId, payload });
  }
}

export { PROFESSIONAL_ROLES, canTransition };
export default { ProjectManagerCoordinator, PROFESSIONAL_ROLES, canTransition };
