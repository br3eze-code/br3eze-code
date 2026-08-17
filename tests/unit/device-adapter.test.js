import { assertDeviceActionScope, DeviceAdapterRegistry } from '../../src/core/device-adapter.js';

describe('DeviceAdapterRegistry and device action boundary', () => {
  const adapter = {
    type: 'mikrotik',
    discover: () => null,
    captureFingerprint: () => null,
    verifyIdentity: () => null,
    previewBaseline: () => null,
    applyBaseline: () => null,
    testConnectivity: () => null
  };

  test('registers a protocol adapter without making it an AgentOS primitive', () => {
    const registry = new DeviceAdapterRegistry();
    expect(registry.register(adapter)).toBe('mikrotik');
    expect(registry.get('mikrotik')).toBe(adapter);
    expect(() => registry.register(adapter)).toThrow('already registered');
  });

  test('requires tenant, site, device, principal, and secret scope', () => {
    expect(() => assertDeviceActionScope({
      scope: { tenantId: 'tenant-a', siteId: null, deviceId: 'router-a', principalId: 'principal-a' },
      action: 'discover',
      secretRef: 'secret://router-a'
    })).toThrow('siteId is required');
    expect(() => assertDeviceActionScope({
      scope: { tenantId: 'tenant-a', siteId: 'site-a', deviceId: 'router-a', principalId: 'principal-a' },
      action: 'discover'
    })).toThrow('secret reference required');
  });

  test('requires approval for configuration and activation mutations', () => {
    const scope = { tenantId: 'tenant-a', siteId: 'site-a', deviceId: 'router-a', principalId: 'principal-a' };
    expect(() => assertDeviceActionScope({ scope, action: 'applyBaseline', secretRef: 'secret://router-a' }))
      .toThrow('approval required');
    expect(assertDeviceActionScope({
      scope,
      action: 'applyBaseline',
      approved: true,
      secretRef: 'secret://router-a'
    })).toMatchObject(scope);
  });
});
