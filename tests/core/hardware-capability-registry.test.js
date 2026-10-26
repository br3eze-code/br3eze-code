import { describe, expect, test, jest } from '@jest/globals';
import { HardwareCapabilityRegistry } from '../../src/core/hardware/HardwareCapabilityRegistry.js';

const auth = { tenantId: 'tenant-a', userId: 'operator-1' };

describe('HardwareCapabilityRegistry', () => {
  test('executes only a declared read capability with authenticated tenant context', async () => {
    const execute = jest.fn(async (_args, context) => ({ online: true, deviceId: context.deviceId }));
    const registry = new HardwareCapabilityRegistry();
    registry.registerAdapter({
      id: 'sensor-1',
      capabilities: [{ name: 'status', access: 'read', schema: { type: 'object', properties: {} }, execute }],
    });

    await expect(registry.execute('hardware.sensor-1.status', {}, auth))
      .resolves.toMatchObject({ online: true, deviceId: 'sensor-1' });
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(registry.execute('hardware.sensor-1.unknown', {}, auth)).rejects.toThrow('not found');
  });

  test('fails closed without tenant/user identity', async () => {
    const execute = jest.fn();
    const registry = new HardwareCapabilityRegistry();
    registry.registerAdapter({
      id: 'sensor-1',
      capabilities: [{ name: 'status', access: 'read', execute }],
    });
    await expect(registry.execute('hardware.sensor-1.status', {}, { userId: 'operator-1' }))
      .rejects.toThrow('authenticated tenant and user');
    expect(execute).not.toHaveBeenCalled();
  });

  test('requires explicit approval for hardware writes', async () => {
    const execute = jest.fn(async () => ({ moved: true }));
    const registry = new HardwareCapabilityRegistry();
    registry.registerAdapter({
      id: 'robot-1',
      capabilities: [{ name: 'move', access: 'write', execute }],
    });

    await expect(registry.execute('hardware.robot-1.move', { direction: 'forward' }, auth))
      .rejects.toThrow('requires explicit approval');
    expect(execute).not.toHaveBeenCalled();

    await expect(registry.execute('hardware.robot-1.move', { direction: 'forward' }, {
      ...auth, approvalGranted: true, approvalId: 'approval-123',
    })).resolves.toEqual({ moved: true });
    expect(execute).toHaveBeenCalledWith(
      { direction: 'forward' },
      expect.objectContaining({ approved: true, approvalId: 'approval-123', tenantId: 'tenant-a' }),
    );
  });

  test('rejects duplicate adapter and capability names before mounting', () => {
    const registry = new HardwareCapabilityRegistry();
    const adapter = {
      id: 'sensor-1',
      capabilities: [
        { name: 'status', access: 'read', execute: async () => ({}) },
        { name: 'status', access: 'read', execute: async () => ({}) },
      ],
    };
    expect(() => registry.registerAdapter(adapter)).toThrow('already registered');
    expect(registry.listCapabilities()).toHaveLength(0);
  });

  test('mounts declared capabilities into the supplied canonical tool registry', () => {
    const toolRegistry = { register: jest.fn() };
    const registry = new HardwareCapabilityRegistry();
    registry.registerAdapter({
      id: 'camera-1',
      capabilities: [
        { name: 'snapshot', access: 'read', schema: { type: 'object', properties: {} }, execute: async () => 'ok' },
        { name: 'pan', access: 'write', schema: { type: 'object', properties: {} }, execute: async () => 'ok' },
      ],
    });

    registry.mount(toolRegistry);
    expect(toolRegistry.register).toHaveBeenCalledTimes(2);
    expect(toolRegistry.register).toHaveBeenCalledWith(
      'hardware.camera-1.pan',
      expect.objectContaining({
        requiresApproval: true,
        passContext: true,
        schema: expect.objectContaining({ risk: 'high', requiresApproval: true }),
      }),
    );
  });
});
