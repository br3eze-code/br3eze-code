import { describe, expect, test } from '@jest/globals';
import { HardwareCapabilityRegistry } from '../../src/core/hardware/HardwareCapabilityRegistry.js';
import { createNodeHostHardwareAdapter } from '../../src/adapters/hardware/node-host-adapter.js';

describe('Node host hardware adapter', () => {
  const osModule = {
    platform: () => 'test-os',
    arch: () => 'test-arch',
    release: () => '1.2.3',
    cpus: () => [{}, {}, {}],
    totalmem: () => 4096,
    freemem: () => 1024,
    uptime: () => 42,
  };

  test('registers read-only diagnostics through the canonical hardware capability registry', async () => {
    const registry = new HardwareCapabilityRegistry();
    registry.registerAdapter(createNodeHostHardwareAdapter({ osModule }));
    expect(registry.listCapabilities()).toMatchObject([{
      name: 'hardware.nodehost.diagnostics',
      adapterId: 'nodehost',
      access: 'read',
      requiresApproval: false,
    }]);
    await expect(registry.execute('hardware.nodehost.diagnostics', {}, {
      tenantId: 'tenant-a',
      userId: 'user-a',
    })).resolves.toEqual({
      platform: 'test-os',
      architecture: 'test-arch',
      release: '1.2.3',
      cpuCount: 3,
      totalMemoryBytes: 4096,
      freeMemoryBytes: 1024,
      uptimeSeconds: 42,
    });
  });

  test('requires authenticated tenant and user context', async () => {
    const registry = new HardwareCapabilityRegistry();
    registry.registerAdapter(createNodeHostHardwareAdapter({ osModule }));
    await expect(registry.execute('hardware.nodehost.diagnostics')).rejects.toThrow('authenticated tenant and user');
  });

  test('does not expose shell or process execution capabilities', () => {
    const adapter = createNodeHostHardwareAdapter({ osModule });
    expect(adapter.capabilities.map((capability) => capability.name)).toEqual(['diagnostics']);
    expect(adapter.capabilities[0].access).toBe('read');
    expect(adapter.capabilities[0].execute).toBeInstanceOf(Function);
  });
});
