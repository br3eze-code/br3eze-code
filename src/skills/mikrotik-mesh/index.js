import MikroTikMeshRegistry from '../../core/mikrotik-mesh.js';

export default class MikroTikMeshSkill {
  constructor(config = {}) {
    this.config = config;
    this.mesh = config.mikrotikMeshRegistry || new MikroTikMeshRegistry({
      auditSink: config.meshAuditSink,
    });
    const sites = config.mikrotikMesh?.sites || config.mikrotik?.sites || [];
    for (const site of sites) {
      try { this.mesh.register(site); } catch (_) { /* invalid site is reported by onboarding */ }
    }
  }

  async initialize() {
    return { sites: this.mesh.list().length };
  }

  async execute(toolName, params = {}, context = {}) {
    const tenantContext = {
      tenantId: context.tenantId,
      authorizedSiteIds: context.authorizedSiteIds || [],
      role: context.role,
      allowFleet: context.allowFleet === true,
      confirmed: context.confirmed === true,
    };

    if (toolName === 'mesh.list_sites') return this.mesh.list({ tenantId: tenantContext.tenantId });
    if (toolName === 'mesh.site_health') return this.mesh.health(params.siteIds, tenantContext);
    if (toolName === 'mesh.fleet_health') {
      return this.mesh.health(tenantContext.authorizedSiteIds, tenantContext);
    }
    if (toolName === 'mesh.execute_readonly') {
      return this.mesh.execute(params.siteId, params.tool, params.params || {}, tenantContext);
    }
    if (toolName === 'mesh.execute_change') {
      if (!params.approvalId || tenantContext.confirmed !== true) {
        const error = new Error('An approvalId and confirmed approval are required');
        error.code = 'MESH_APPROVAL_REQUIRED';
        throw error;
      }
      return this.mesh.execute(params.siteId, params.tool, params.params || {}, tenantContext);
    }
    throw new Error(`Unknown mikrotik-mesh tool: ${toolName}`);
  }

  async destroy() {
    await this.mesh.destroy();
  }
}
