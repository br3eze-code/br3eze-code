import { describe, expect, test, jest } from '@jest/globals';
import { AgentRuntime, getAgentRuntime } from '../../src/core/agentRuntime.js';
import AgentOS from '../../src/core/AgentOS.js';
import { AgentHarness } from '../../src/harness/AgentHarness.js';
import { AgentKernel } from '../../src/core/agentKernel.js';

describe('canonical runtime composition', () => {
  test('AgentOS and AgentHarness reuse the shared AgentRuntime', async () => {
    const runtime = getAgentRuntime();
    const os = new AgentOS();
    const harness = new AgentHarness();
    const kernel = new AgentKernel();

    expect(os.runtime).toBe(runtime);
    expect(kernel.runtime).toBe(runtime);
    const generateText = jest.spyOn(runtime, 'generateText').mockResolvedValue({ text: 'use the runtime model port' });
    await expect(os.llm.generate('help me', { maxTokens: 64 })).resolves.toEqual({ text: 'use the runtime model port' });
    expect(generateText).toHaveBeenCalledWith('help me', { maxTokens: 64 });
    expect(() => getAgentRuntime({ runtime: new AgentRuntime() })).toThrow(/already composed/);

    await harness.start();
    expect(harness._runtime).toBe(runtime);
    expect(harness._registry).toBe(runtime.toolRegistry);

    await harness.stop();
    await kernel.close();
    await os.destroy();
    generateText.mockRestore();
  });
});

describe('AgentRuntime text generation port', () => {
  test('uses the configured model port with tools disabled', async () => {
    const execute = jest.fn().mockResolvedValue({ content: 'plain text answer', provider: 'test-provider' });
    const runtime = new AgentRuntime({ model: { execute } });
    await expect(runtime.generateText('explain this', { maxTokens: 80, context: { tenantId: 'tenant-1' } }))
      .resolves.toEqual({ text: 'plain text answer', provider: 'test-provider', usage: null });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      tools: [],
      messages: [{ role: 'user', content: 'explain this' }],
      context: expect.objectContaining({ tenantId: 'tenant-1', outputTokenBudget: 80 }),
    }));
  });
});
