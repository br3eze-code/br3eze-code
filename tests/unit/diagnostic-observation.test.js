import { describe, expect, test } from '@jest/globals';
import { DiagnosticEventStore, redactDiagnosticText } from '../../src/core/diagnostics/diagnostic-store.js';
import { createDiagnosticTools } from '../../src/core/diagnostics/diagnostic-tools.js';
import { createBrowserDiagnosticsScript } from '../../src/adapters/diagnostics/browser-observer.js';

describe('AgentOS diagnostic observation', () => {
  test('bounds retained events and redacts common secrets before storage', () => {
    const store = new DiagnosticEventStore({ maxEvents: 2 });
    store.record({ source: 'browser.console', level: 'error', message: 'token=secret-value failed' });
    expect(store.list()[0].message).toContain('[REDACTED]');
    store.record({ source: 'browser.network', level: 'error', message: 'second failure' });
    store.record({ source: 'browser.runtime', level: 'error', message: 'third failure' });

    const events = store.list();
    expect(events).toHaveLength(2);
    expect(events[0].message).toBe('second failure');
    expect(JSON.stringify(events)).not.toContain('secret-value');
    expect(redactDiagnosticText('Authorization: Bearer abc.def')).toContain('[REDACTED]');
  });

  test('exposes diagnostics through the supplied provider without creating a second runtime', async () => {
    const store = new DiagnosticEventStore();
    store.record({ source: 'browser.console', level: 'error', message: 'ReferenceError: missingThing' });
    const tools = createDiagnosticTools({ store, provider: { getCapabilities: async () => ({ screenCapture: false, notifications: false }) } });

    expect(tools.map((tool) => tool.name)).toEqual([
      'diagnostics.capabilities',
      'diagnostics.events',
      'diagnostics.capture',
      'diagnostics.notifications',
    ]);
    expect(await tools[1].execute({ limit: 10 }, { tenantId: 'local' })).toHaveLength(1);
    expect(await tools[2].execute({})).toMatchObject({ available: false });
    expect(await tools[3].execute({})).toMatchObject({ available: false });
    expect(tools[2].requiresApproval).toBe(true);
    expect(tools[3].requiresApproval).toBe(true);
  });

  test('does not expose one tenant’s diagnostic events to another tenant', async () => {
    const store = new DiagnosticEventStore();
    store.record({ tenantId: 'tenant-a', source: 'browser.console', level: 'error', message: 'tenant A error' });
    store.record({ tenantId: 'tenant-b', source: 'browser.console', level: 'error', message: 'tenant B error' });
    const tools = createDiagnosticTools({ store });
    expect(await tools[1].execute({}, { tenantId: 'tenant-a' })).toHaveLength(1);
    expect((await tools[1].execute({}, { tenantId: 'tenant-a' }))[0].message).toBe('tenant A error');
    expect((await tools[1].execute({}, { tenantId: 'tenant-b' })).map((event) => event.message)).toEqual(['tenant B error']);
  });

  test('fails closed when an optional provider cannot report capabilities', async () => {
    const tools = createDiagnosticTools({
      store: new DiagnosticEventStore(),
      provider: { getCapabilities: async () => { throw new Error('provider failure'); } },
    });
    expect(await tools[0].execute()).toEqual({ browserEvents: true, screenCapture: false, notifications: false });
    expect(await tools[2].execute({})).toMatchObject({ available: false });
    expect(await tools[3].execute({})).toMatchObject({ available: false });
  });

  test('passes only minimal session context to approved providers', async () => {
    const captureScreen = jest.fn(async () => ({ available: true, mediaType: 'image/png' }));
    const readNotifications = jest.fn(async () => []);
    const tools = createDiagnosticTools({
      store: new DiagnosticEventStore(),
      provider: {
        getCapabilities: async () => ({ screenCapture: true, notifications: true, arbitraryExtra: 'ignored' }),
        captureScreen,
        readNotifications,
      },
    });
    const context = { tenantId: 'tenant-a', sessionId: 'session-a', authorization: 'must-not-leak' };
    await tools[2].execute({}, context);
    await tools[3].execute({}, context);
    expect(captureScreen).toHaveBeenCalledWith({ context: { tenantId: 'tenant-a', sessionId: 'session-a' } });
    expect(readNotifications).toHaveBeenCalledWith({ context: { tenantId: 'tenant-a', sessionId: 'session-a' } });
    expect(await tools[0].execute()).toEqual({ browserEvents: true, screenCapture: true, notifications: true });
  });

  test('browser observer captures console errors, unhandled exceptions and failed fetches without request bodies', () => {
    const script = createBrowserDiagnosticsScript();
    expect(script).toContain('console.error');
    expect(script).toContain('unhandledrejection');
    expect(script).toContain('fetch');
    expect(script).toContain('MutationObserver');
    expect(script).toContain('browser.notification');
    expect(script).toContain('/__agentos/diagnostics/events');
    expect(script).not.toContain('request.body');
  });
});
