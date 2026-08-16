import { buildExecutionContext } from '../../src/core/execution-context.js';
import { buildChannelUiPolicy } from '../../src/core/channel-ui-policy.js';
import {
  CAPABILITIES,
  normalizeIotContext,
  assertNearbyDiscovery,
} from '../../src/core/iot-context.js';

describe('location context and permission boundaries', () => {
  test('redacts profile location and address without explicit permission', () => {
    const context = buildExecutionContext({
      channel: 'telegram',
      userId: 'user-1',
      location: { latitude: -17.8, longitude: 31.0 },
      address: 'private address',
      authorizedCapabilities: ['network.read', 'device.nearby.discover'],
    });

    expect(context.locationPermission).toBe(false);
    expect(context.location).toBeNull();
    expect(context.address).toBeNull();
    expect(context.uiPolicy.actions).not.toContain('device.nearby.discover');
  });

  test('propagates only explicitly granted location context to the channel policy', () => {
    const context = buildExecutionContext({
      channel: 'whatsapp',
      userId: 'user-2',
      locationPermission: 'granted',
      location: { latitude: -17.8, longitude: 31.0 },
      authorizedCapabilities: ['device.nearby.discover'],
    });

    expect(context.locationPermission).toBe(true);
    expect(context.location.latitude).toBe(-17.8);
    expect(context.uiPolicy.actions).toContain('device.nearby.discover');
  });

  test('nearby discovery rejects a caller-supplied nearby flag without location permission', () => {
    const context = normalizeIotContext({
      userId: 'user-3',
      tenantId: 'tenant-1',
      domain: 'network',
      siteId: 'site-1',
      nearby: true,
      capabilities: [CAPABILITIES.DEVICE_DISCOVER],
    });

    expect(() => assertNearbyDiscovery(context)).toThrow(/location permission/);
  });

  test('nearby discovery accepts trusted explicit permission and site scope', () => {
    const context = normalizeIotContext({
      userId: 'user-4',
      tenantId: 'tenant-1',
      domain: 'network',
      siteId: 'site-1',
      nearby: true,
      locationPermission: 'granted',
      capabilities: [CAPABILITIES.DEVICE_DISCOVER],
    });

    expect(() => assertNearbyDiscovery(context)).not.toThrow();
  });

  test('broad read capability alone does not expose nearby discovery in any channel', () => {
    for (const channel of ['telegram', 'whatsapp', 'web', 'desktop']) {
      const policy = buildChannelUiPolicy({
        channel,
        authorizedCapabilities: ['network.read'],
        locationPermission: false,
      });
      expect(policy.actions).not.toContain('device.nearby.discover');
    }
  });
});

export {};
