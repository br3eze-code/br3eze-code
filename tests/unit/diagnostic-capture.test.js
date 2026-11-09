import { describe, expect, test } from '@jest/globals';
import { DiagnosticCaptureStore } from '../../src/core/diagnostics/diagnostic-capture-store.js';
import { createBrowserObservationProvider } from '../../src/adapters/diagnostics/browser-observation-provider.js';
import { DiagnosticEventStore } from '../../src/core/diagnostics/diagnostic-store.js';

const png = 'data:image/png;base64,iVBORw0KGgo=';

describe('local browser screen and notification diagnostics', () => {
  test('stores only bounded image data and returns metadata without pixels by default', () => {
    const store = new DiagnosticCaptureStore({ maxBytes: 64 });
    const capture = store.record({ dataUrl: png, tenantId: 'tenant-a', width: 640, height: 480 });
    expect(capture).toMatchObject({ tenantId: 'tenant-a', mediaType: 'image/png', width: 640, height: 480 });
    expect(capture.dataUrl).toBe(png);
    expect(store.getLatestMetadata({ tenantId: 'tenant-a' })).toMatchObject({
      id: capture.id, mediaType: 'image/png', width: 640, height: 480,
    });
    expect(JSON.stringify(store.getLatestMetadata({ tenantId: 'tenant-a' }))).not.toContain('iVBORw0KGgo');
  });

  test('rejects non-image data, malformed base64 and captures over the byte limit', () => {
    const store = new DiagnosticCaptureStore({ maxBytes: 8 });
    expect(() => store.record({ dataUrl: 'data:text/html;base64,PHNjcmlwdD4=', tenantId: 'local' }))
      .toThrow('INVALID_SCREEN_CAPTURE');
    expect(() => store.record({ dataUrl: 'data:image/png;base64,not base64!', tenantId: 'local' }))
      .toThrow('INVALID_SCREEN_CAPTURE');
    expect(() => store.record({ dataUrl: 'data:image/png;base64,QUFBQUFBQUFBQUFB', tenantId: 'local' }))
      .toThrow('SCREEN_CAPTURE_TOO_LARGE');
  });

  test('isolates the latest capture by tenant', () => {
    const store = new DiagnosticCaptureStore();
    const a = store.record({ dataUrl: png, tenantId: 'tenant-a' });
    store.record({ dataUrl: 'data:image/jpeg;base64,/9j/2Q==', tenantId: 'tenant-b' });
    expect(store.getLatestMetadata({ tenantId: 'tenant-a' }).id).toBe(a.id);
    expect(store.getLatestMetadata({ tenantId: 'tenant-b' }).mediaType).toBe('image/jpeg');
    expect(store.getLatestMetadata({ tenantId: 'tenant-c' })).toBeNull();
  });

  test('provider exposes browser capabilities but never claims OS notification access', async () => {
    const events = new DiagnosticEventStore();
    events.record({ tenantId: 'tenant-a', source: 'browser.notification', level: 'info', message: 'Notification created: Build complete' });
    events.record({ tenantId: 'tenant-a', source: 'browser.notification', level: 'error', message: 'Save failed' });
    events.record({ tenantId: 'tenant-b', source: 'browser.notification', level: 'info', message: 'Other tenant' });
    const provider = createBrowserObservationProvider({ captureStore: new DiagnosticCaptureStore(), eventStore: events });
    expect(await provider.getCapabilities()).toEqual({
      screenCapture: true, notifications: true, osNotifications: false,
    });
    expect(await provider.readNotifications({ context: { tenantId: 'tenant-a' } }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ message: 'Notification created: Build complete' }),
        expect.objectContaining({ message: 'Save failed' }),
      ]));
    expect(JSON.stringify(await provider.readNotifications({ context: { tenantId: 'tenant-a' } }))).not.toContain('Other tenant');
    expect(await provider.captureScreen({ context: { tenantId: 'tenant-a' } }))
      .toMatchObject({ available: false, reason: 'NO_USER_APPROVED_CAPTURE' });
  });

  test('provider returns the latest capture path without returning image bytes to the agent', async () => {
    const captureStore = new DiagnosticCaptureStore();
    const capture = captureStore.record({ dataUrl: png, tenantId: 'tenant-a', width: 320, height: 200 });
    const provider = createBrowserObservationProvider({ captureStore, eventStore: new DiagnosticEventStore() });
    const result = await provider.captureScreen({ context: { tenantId: 'tenant-a' } });
    expect(result).toMatchObject({
      available: true, id: capture.id, mediaType: 'image/png',
      previewPath: '/__agentos/diagnostics/captures/latest',
    });
    expect(JSON.stringify(result)).not.toContain('iVBORw0KGgo');
  });
});
