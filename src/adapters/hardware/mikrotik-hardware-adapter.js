const CAPABILITY_TO_TOOL = Object.freeze({
  system_stats: 'system.stats',
  interfaces_list: 'interface.list',
  hotspot_active_users: 'users.active',
});

/**
 * Exposes a narrow, read-only hardware capability surface over the existing
 * MikroTik manager. Mutations are deliberately not exposed by this adapter.
 */
export function createMikroTikHardwareAdapter({ id = 'mikrotik', deviceId = null, manager } = {}) {
  if (!manager || typeof manager.executeTool !== 'function') {
    throw new TypeError('MikroTik manager with executeTool(name) is required');
  }

  const capabilities = Object.entries(CAPABILITY_TO_TOOL).map(([name, tool]) => Object.freeze({
    name,
    access: 'read',
    async execute(_args = {}, context = {}) {
      if (context.signal?.aborted) {
        throw context.signal.reason instanceof Error
          ? context.signal.reason
          : new Error('Operation cancelled');
      }
      if (context.tenantId && typeof context.tenantId !== 'string') {
        throw new TypeError('tenantId must be a string');
      }
      if (context.userId && typeof context.userId !== 'string') {
        throw new TypeError('userId must be a string');
      }
      const result = await manager.executeTool(tool);
      if (context.signal?.aborted) {
        throw context.signal.reason instanceof Error
          ? context.signal.reason
          : new Error('Operation cancelled');
      }
      return result;
    },
  }));

  return Object.freeze({
    id,
    deviceId,
    provider: 'mikrotik',
    capabilities: Object.freeze(capabilities),
    async close() {
      await manager.disconnect?.();
    },
  });
}

export default createMikroTikHardwareAdapter;
