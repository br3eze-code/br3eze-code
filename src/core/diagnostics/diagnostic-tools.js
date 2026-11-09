async function safeCapabilities(provider) {
  if (typeof provider?.getCapabilities !== 'function') {
    return { screenCapture: false, notifications: false, browserNotifications: false, osNotifications: false };
  }
  try {
    const capabilities = await provider.getCapabilities();
    return {
      screenCapture: capabilities?.screenCapture === true,
      notifications: capabilities?.notifications === true,
      browserNotifications: capabilities?.browserNotifications === true || capabilities?.notifications === true,
      osNotifications: capabilities?.osNotifications === true,
    };
  } catch {
    // Optional host adapters must fail closed. A broken provider is not a capability.
    return { screenCapture: false, notifications: false };
  }
}

function safeProviderContext(context = {}) {
  return {
    tenantId: typeof context.tenantId === 'string' ? context.tenantId.slice(0, 128) : 'local',
    sessionId: typeof context.sessionId === 'string' ? context.sessionId.slice(0, 128) : null,
  };
}

export function createDiagnosticTools({ store, provider = null } = {}) {
  if (!store || typeof store.list !== 'function' || typeof store.record !== 'function') {
    throw new TypeError('DIAGNOSTIC_EVENT_STORE_REQUIRED');
  }
  return [
    {
      name: 'diagnostics.capabilities',
      passContext: true,
      description: 'Report local browser observation capabilities. Operating-system notification access is not supported.',
      keywords: ['diagnostics', 'capabilities', 'screen', 'notifications'],
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'low',
      requiresApproval: false,
      execute: async () => ({ browserEvents: true, ...(await safeCapabilities(provider)) }),
    },
    {
      name: 'diagnostics.events',
      passContext: true,
      description: 'Read recent redacted browser diagnostic events such as console errors, unhandled exceptions, and failed HTTP requests.',
      keywords: ['diagnostics', 'errors', 'console', 'network', 'debug', 'logs'],
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          source: { type: 'string', enum: ['browser.console', 'browser.runtime', 'browser.network', 'browser.notification', 'browser.screen'] },
          level: { type: 'string', enum: ['error', 'warn', 'info'] },
        },
        additionalProperties: false,
      },
      risk: 'low',
      requiresApproval: false,
      execute: async (args = {}, context = {}) => store.list({ limit: args.limit, source: args.source, level: args.level, tenantId: context.tenantId || 'local' }),
    },
    {
      name: 'diagnostics.capture',
      passContext: true,
      description: 'Read metadata for the latest user-approved local browser screen capture. Use the browser capture button first.',
      keywords: ['diagnostics', 'screen', 'screenshot', 'capture'],
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'medium',
      requiresApproval: true,
      execute: async (args = {}, context = {}) => {
        const capabilities = await safeCapabilities(provider);
        if (!capabilities.screenCapture || typeof provider?.captureScreen !== 'function') {
          return { available: false, reason: 'SCREEN_CAPTURE_PROVIDER_UNAVAILABLE' };
        }
        return provider.captureScreen({ ...args, context: safeProviderContext(context) });
      },
    },
    {
      name: 'diagnostics.notifications',
      passContext: true,
      description: 'Read redacted browser notification titles and visible in-page alerts. Notification bodies and the operating-system tray are not read.',
      keywords: ['diagnostics', 'notifications', 'alerts', 'desktop'],
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      risk: 'medium',
      requiresApproval: true,
      execute: async (args = {}, context = {}) => {
        const capabilities = await safeCapabilities(provider);
        if (!capabilities.notifications || typeof provider?.readNotifications !== 'function') {
          return { available: false, reason: 'NOTIFICATION_PROVIDER_UNAVAILABLE' };
        }
        return provider.readNotifications({ ...args, context: safeProviderContext(context) });
      },
    },
  ];
}
