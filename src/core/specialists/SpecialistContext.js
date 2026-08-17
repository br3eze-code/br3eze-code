export function createSpecialistContext(input = {}) {
  const tenantId = input.tenantId || input.scope?.tenantId;
  const userId = input.userId || input.scope?.userId;
  if (!tenantId || !userId) throw new Error('tenantId and userId are required');
  return Object.freeze({
    tenantId,
    userId,
    projectId: input.projectId || null,
    channel: input.channel || 'internal',
    conversationId: input.conversationId || null,
    correlationId: input.correlationId || null,
    siteId: input.siteId || input.scope?.siteId || null,
    permissions: Object.freeze([...(input.authorizedCapabilities || input.permissions || [])]),
    agentRole: input.agentRole || input.role || null,
    approval: input.approval || null,
    services: input.services || null,
    providers: input.providers || null,
    inventory: input.inventory || input.services?.inventory || input.providers?.inventory || null,
    catalog: input.catalog || input.services?.catalog || input.providers?.catalog || null,
    productQueryService: input.productQueryService || input.services?.productQueryService || input.providers?.productQueryService || null,
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}

export default createSpecialistContext;
