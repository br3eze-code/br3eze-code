export class AgentMatrixError extends Error {
  constructor(message, code = 'MATRIX_INVALID') {
    super(message);
    this.name = 'AgentMatrixError';
    this.code = code;
  }
}

const REQUIRED_RESOURCE_SCOPE = ['tenantId'];
const RESOURCE_FIELDS = ['projectId', 'meshGroupId', 'siteIds', 'nodeIds', 'userId', 'sessionId', 'activityId'];

function assertNonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AgentMatrixError(`${field} is required`, 'MATRIX_SCOPE_REQUIRED');
  }
}

function normalizeIds(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

export class AgentMatrixRegistry {
  constructor(registry) {
    if (!registry || typeof registry !== 'object') {
      throw new AgentMatrixError('A matrix registry object is required');
    }
    this.registry = registry;
    this.cells = new Map((registry.accountabilityCells || []).map((cell) => [cell.id, cell]));
    this.channels = new Map((registry.channels || []).map((channel) => [channel.id, channel]));
    this.capabilities = new Map();
    for (const family of registry.capabilityFamilies || []) {
      for (const capability of family.capabilities || []) this.capabilities.set(capability, family.id);
    }
  }

  getCell(cellId) {
    const cell = this.cells.get(cellId);
    if (!cell) throw new AgentMatrixError(`Unknown accountability cell: ${cellId}`, 'MATRIX_CELL_UNKNOWN');
    return cell;
  }

  getChannel(channelId) {
    const channel = this.channels.get(channelId);
    if (!channel) throw new AgentMatrixError(`Unknown channel: ${channelId}`, 'MATRIX_CHANNEL_UNKNOWN');
    return channel;
  }

  assertCapability(capability) {
    if (!this.capabilities.has(capability)) {
      throw new AgentMatrixError(`Unknown capability: ${capability}`, 'MATRIX_CAPABILITY_UNKNOWN');
    }
  }

  assertScope(scope = {}) {
    for (const field of REQUIRED_RESOURCE_SCOPE) assertNonEmpty(scope[field], field);
    for (const field of RESOURCE_FIELDS) {
      if (scope[field] !== undefined && normalizeIds(scope[field]).length === 0) {
        throw new AgentMatrixError(`${field} cannot be empty`, 'MATRIX_SCOPE_INVALID');
      }
    }
    const siteIds = normalizeIds(scope.siteIds);
    const nodeIds = normalizeIds(scope.nodeIds);
    if (nodeIds.length > 0 && siteIds.length === 0) {
      throw new AgentMatrixError('nodeIds require an explicit siteIds scope', 'MATRIX_SCOPE_INVALID');
    }
    return {
      tenantId: scope.tenantId,
      ...Object.fromEntries(RESOURCE_FIELDS.filter((field) => scope[field] !== undefined).map((field) => [field, normalizeIds(scope[field])]))
    };
  }

  resolve({ accountabilityCellId, capability, channelId, scope, approvalId = null, traceId, actorId }) {
    const cell = this.getCell(accountabilityCellId);
    const channel = this.getChannel(channelId);
    this.assertCapability(capability);
    const normalizedScope = this.assertScope(scope);
    assertNonEmpty(actorId, 'actorId');
    assertNonEmpty(traceId, 'traceId');
    if (channel.requiresExplicitSelection && (!normalizedScope.siteIds || normalizedScope.siteIds.length === 0) && capability !== 'health.read') {
      throw new AgentMatrixError(`Channel ${channelId} requires an explicit site selection`, 'MATRIX_SELECTION_REQUIRED');
    }
    return {
      accountabilityCellId: cell.id,
      capability,
      capabilityFamily: this.capabilities.get(capability),
      channelId: channel.id,
      scope: normalizedScope,
      approvalId,
      traceId,
      actorId,
      modelOnCriticalPath: capability === 'health.read' ? false : undefined
    };
  }

  canMutate(intersection) {
    const cell = this.getCell(intersection.accountabilityCellId);
    return Boolean(intersection.approvalId) && cell.approvalCapabilities?.includes(intersection.capability);
  }

  assertMutation(intersection) {
    if (!this.canMutate(intersection)) {
      throw new AgentMatrixError('Mutation requires an approval owned by the resolved accountability cell', 'MATRIX_APPROVAL_REQUIRED');
    }
    return intersection;
  }
}

export function createAgentMatrixRegistry(registry) {
  return new AgentMatrixRegistry(registry);
}
