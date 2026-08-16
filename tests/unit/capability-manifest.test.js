import { buildCapabilityManifest } from '../../src/core/capability-manifest.js';

describe('capability manifest', () => {
  const tools = [
    'system.stats',
    'mikrotik.system.reboot',
    'cctv.stream.multi',
    'shop.checkout',
    'unknown.provider.action',
  ];

  test('anonymous Cordova clients receive no executable tools', () => {
    expect(buildCapabilityManifest({ availableTools: tools })).toMatchObject({
      platform: 'cordova',
      authenticated: false,
      tools: [],
      toolCount: 0,
      restrictedToolCount: tools.length,
    });
  });

  test('capabilities authorize provider-specific tools through provider-neutral policy', () => {
    const manifest = buildCapabilityManifest({
      user: { uid: 'u-1', role: 'operator', capabilities: ['network.read', 'surveillance.read'] },
      availableTools: tools,
      platform: 'cordova',
      channel: 'whatsapp',
      bridges: { networkTools: true, connectivity: true },
    });

    expect(manifest).toMatchObject({
      authenticated: true,
      platform: 'cordova',
      channel: 'whatsapp',
      capabilities: ['network.read', 'surveillance.read'],
      bridges: { networkTools: true, connectivity: true },
    });
    expect(manifest.tools).toEqual(['cctv.stream.multi']);
    expect(manifest.tools).not.toContain('mikrotik.system.reboot');
    expect(manifest.tools).not.toContain('shop.checkout');
  });

  test('administrators see all currently available tools without changing the source policy', () => {
    const manifest = buildCapabilityManifest({
      user: { id: 'admin-1', role: 'admin' },
      availableTools: tools,
    });
    expect(manifest.tools).toEqual(tools);
    expect(manifest.capabilities.length).toBeGreaterThan(5);
    expect(manifest.restrictedToolCount).toBe(0);
  });
});
