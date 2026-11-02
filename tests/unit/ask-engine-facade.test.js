import { describe, expect, jest, test } from '@jest/globals';
import AskEngine from '../../src/core/ask-engine.js';

describe('AskEngine compatibility facade', () => {
  test('delegates run and processQuery to the canonical runtime', async () => {
    const runtime = {
      execute: jest.fn(),
      run: jest.fn().mockResolvedValue({ response: 'hello', toolsUsed: [] }),
      executeTool: jest.fn(),
      listTools: () => ['system.stats'],
      getCapabilityManifest: () => ({ version: '1.0', tools: [{ name: 'system.stats' }] }),
    };
    const engine = new AskEngine({ runtime, mikrotik: {} });
    await expect(engine.run('hello', { tenantId: 'tenant-a' })).resolves.toMatchObject({
      response: 'hello',
      text: 'hello',
      type: 'ai_chat',
    });
    expect(runtime.run).toHaveBeenCalledWith('hello', { tenantId: 'tenant-a' });
    await engine.processQuery('again');
    expect(runtime.run).toHaveBeenCalledTimes(2);
    expect(engine.legacyDependencies).toEqual(['mikrotik']);
  });

  test('delegates tool execution and discovery without creating a second loop', async () => {
    const runtime = {
      execute: jest.fn(),
      run: jest.fn(),
      executeTool: jest.fn().mockResolvedValue({ ok: true }),
      listTools: () => ['network.inspect'],
      getCapabilityManifest: () => ({ version: '1.0', tools: [] }),
    };
    const engine = new AskEngine({ runtime });
    await expect(engine.executeTool('network.inspect', {}, { tenantId: 'tenant-a' })).resolves.toEqual({ ok: true });
    expect(engine.getAvailableTools()).toEqual(['network.inspect']);
    expect(engine.getCapabilityManifest()).toMatchObject({ version: '1.0' });
    expect(runtime.run).not.toHaveBeenCalled();
  });
});
