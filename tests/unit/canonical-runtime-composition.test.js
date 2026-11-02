import { describe, expect, test } from '@jest/globals';
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
    expect(() => getAgentRuntime({ runtime: new AgentRuntime() })).toThrow(/already composed/);

    await harness.start();
    expect(harness._runtime).toBe(runtime);
    expect(harness._registry).toBe(runtime.toolRegistry);

    await harness.stop();
    await kernel.close();
    await os.destroy();
  });
});
