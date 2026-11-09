async function safeCapabilities(provider) {
  if (typeof provider?.getCapabilities !== 'function') {
    return { screenCapture: false, notifications: false };
  }
  try {
    const capabilities = await provider.getCapabilities();
    return {
      screenCapture: capabilities?.screenCapture === true,
      notifications: capabilities?.notifications === true,
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
      description: 'Report available browser, screen-capture, and operating-system notification observation capabilities.',
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
          source: { type: 'string', enum: ['browser.console', 'browser.runtime', 'browser.network', 'browser.notification'] },
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
      description: 'Capture a screen only through an explicitly authorized platform observation provider.',
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
      description: 'Read operating-system notifications only through an explicitly authorized platform observation provider.',
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
