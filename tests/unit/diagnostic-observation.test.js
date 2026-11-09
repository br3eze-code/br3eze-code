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
    expect(await tools[1].execute({ limit: 10 })).toHaveLength(1);
    expect(await tools[2].execute({})).toMatchObject({ available: false });
    expect(await tools[3].execute({})).toMatchObject({ available: false });
  });

  test('does not expose one tenant’s diagnostic events to another tenant', async () => {
    const store = new DiagnosticEventStore();
    store.record({ tenantId: 'tenant-a', source: 'browser.console', level: 'error', message: 'tenant A error' });
    store.record({ tenantId: 'tenant-b', source: 'browser.console', level: 'error', message: 'tenant B error' });
    const tools = createDiagnosticTools({ store });
    expect(await tools[1].execute({}, { tenantId: 'tenant-a' })).toHaveLength(1);
    expect((await tools[1].execute({}, { tenantId: 'tenant-a' }))[0].message).toBe('tenant A error');
  });

  test('requires provider capabilities for screen and OS notifications', async () => {
    const tools = createDiagnosticTools({
      store: new DiagnosticEventStore(),
      provider: {
        getCapabilities: async () => ({ screenCapture: true, notifications: true }),
        captureScreen: async () => ({ available: true, mediaType: 'image/png', data: 'sample' }),
        readNotifications: async () => [{ source: 'os', title: 'Build failed', text: 'exit code 1' }],
      },
    });
    expect(await tools[2].execute({})).toMatchObject({ available: true, mediaType: 'image/png' });
    expect(await tools[3].execute({})).toEqual([{ source: 'os', title: 'Build failed', text: 'exit code 1' }]);
  });

  test('browser observer captures console errors, unhandled exceptions and failed fetches without request bodies', () => {
    const script = createBrowserDiagnosticsScript();
    expect(script).toContain('console.error');
    expect(script).toContain('unhandledrejection');
    expect(script).toContain('fetch');
    expect(script).toContain('/__agentos/diagnostics/events');
    expect(script).not.toContain('request.body');
  });
});
