const CONTEXT_LEVELS = Object.freeze({
  none: 0,
  tenant: 1,
  domain: 2,
  site: 3,
  device: 4,
  session: 5
});

const CAPABILITIES = Object.freeze({
  DEVICE_READ: 'iot.device.read',
  DEVICE_DISCOVER: 'iot.device.discover',
  DEVICE_CONTROL: 'iot.device.control',
  NETWORK_SUGGEST: 'network.suggest',
  NETWORK_APPLY: 'network.apply',
  CODE_GENERATE: 'developer.codegen'
});

function list(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value === undefined || value === null || value === '') return [];
  return [String(value)];
}

function normalizeIotContext(input = {}) {
  const scope = input.scope || input.authorization || {};
  const inferredLevel = input.contextLevel || scope.contextLevel || (input.deviceId || scope.deviceId ? 'device' : (input.siteId || scope.siteId || (input.siteIds || scope.siteIds) ? 'site' : (input.domain || scope.domain ? 'domain' : 'tenant')));
  const levelName = String(inferredLevel).toLowerCase();
  const contextLevel = CONTEXT_LEVELS[levelName] === undefined ? 'tenant' : levelName;
  const tenantId = input.tenantId || scope.tenantId || null;
  const domain = input.domain || scope.domain || null;
  const siteIds = list(input.siteIds || input.siteId || scope.siteIds || scope.siteId);
  const deviceIds = list(input.deviceIds || input.deviceId || scope.deviceIds || scope.deviceId);
  const allowedDomains = list(input.allowedDomains || scope.allowedDomains);
  const authorizedSiteIds = list(input.authorizedSiteIds || scope.authorizedSiteIds || siteIds);
  const authorizedDeviceIds = list(input.authorizedDeviceIds || scope.authorizedDeviceIds || deviceIds);
  const capabilities = new Set(list(input.capabilities || scope.capabilities));

  if (!tenantId) throw new Error('IoT context requires tenantId');
  if (CONTEXT_LEVELS[contextLevel] >= CONTEXT_LEVELS.domain && !domain && !allowedDomains.length) {
    throw new Error('Domain context requires domain or allowedDomains');
  }
  if (CONTEXT_LEVELS[contextLevel] >= CONTEXT_LEVELS.site && !authorizedSiteIds.length) {
    throw new Error('Site context requires authorizedSiteIds');
  }

  return Object.freeze({
    userId: input.userId || scope.userId || null,
    tenantId,
    domain,
    contextLevel,
    contextDepth: CONTEXT_LEVELS[contextLevel],
    siteIds,
    deviceIds,
    allowedDomains,
    authorizedSiteIds,
    authorizedDeviceIds,
    capabilities: [...capabilities],
    nearby: Boolean(input.nearby || scope.nearby),
    requestId: input.requestId || scope.requestId || null,
    readOnly: input.readOnly !== false && scope.readOnly !== false
  });
}

function hasCapability(ctx, capability) {
  return Array.isArray(ctx?.capabilities) && ctx.capabilities.includes(capability);
}

function assertCapability(ctx, capability, message = `Missing capability: ${capability}`) {
  if (!hasCapability(ctx, capability)) throw new Error(message);
}

function assertDeviceVisible(ctx, { domain, siteId, deviceId } = {}) {
  if (!ctx || !ctx.tenantId) throw new Error('Missing authorized IoT context');
  if (domain && ctx.allowedDomains.length && !ctx.allowedDomains.includes(domain)) {
    throw new Error('Device domain is outside the authorized scope');
  }
  if (siteId && ctx.authorizedSiteIds.length && !ctx.authorizedSiteIds.includes(String(siteId))) {
    throw new Error('Device site is outside the authorized scope');
  }
  if (deviceId && ctx.authorizedDeviceIds.length && !ctx.authorizedDeviceIds.includes(String(deviceId))) {
    throw new Error('Device is outside the authorized scope');
  }
}

function assertNearbyDiscovery(ctx) {
  assertCapability(ctx, CAPABILITIES.DEVICE_DISCOVER);
  if (!ctx.nearby) throw new Error('Nearby-device discovery requires explicit nearby context');
  if (ctx.contextDepth < CONTEXT_LEVELS.site) {
    throw new Error('Nearby-device discovery requires site-level context');
  }
}

function redactIotContext(ctx = {}) {
  return {
    userId: ctx.userId || null,
    tenantId: ctx.tenantId || null,
    domain: ctx.domain || null,
    contextLevel: ctx.contextLevel || 'none',
    siteIds: list(ctx.siteIds),
    deviceIds: list(ctx.deviceIds),
    nearby: Boolean(ctx.nearby),
    capabilities: list(ctx.capabilities)
  };
}

export {
  CONTEXT_LEVELS,
  CAPABILITIES,
  normalizeIotContext,
  hasCapability,
  assertCapability,
  assertDeviceVisible,
  assertNearbyDiscovery,
  redactIotContext
};

export default normalizeIotContext;

