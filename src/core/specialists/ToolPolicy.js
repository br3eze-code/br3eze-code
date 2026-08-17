export class ToolPolicy {
  authorize({ specialist, tool, context = {}, ticketType = null } = {}) {
    if (!specialist) throw new Error('specialist not found');
    if (!tool) throw new Error('tool not found');
    const role = String(specialist.role || specialist.id || '').toLowerCase();
    if (tool.specialist && ![role, String(specialist.id || '').toLowerCase()].includes(String(tool.specialist).toLowerCase())) {
      throw new Error(`Tool ${tool.name} is not owned by specialist ${specialist.id || specialist.role}`);
    }
    const permissions = new Set(context.authorizedCapabilities || context.permissions || []);
    for (const permission of tool.permissions || []) {
      if (!permissions.has(permission)) throw new Error(`Permission denied for ${tool.name}: ${permission}`);
    }
    if (ticketType && tool.ticketTypes?.length && !tool.ticketTypes.includes(ticketType)) {
      throw new Error(`Tool ${tool.name} cannot service ticket type ${ticketType}`);
    }
    if (ticketType && specialist.ticketTypes?.length && !specialist.ticketTypes.includes(ticketType)) {
      throw new Error(`Specialist ${specialist.id || specialist.role} cannot service ticket type ${ticketType}`);
    }
    if (!context.tenantId || !context.userId) throw new Error('tenantId and userId are required');
    return true;
  }
}

export default ToolPolicy;
