import { describe, expect, test } from '@jest/globals';
import { getAgentRuntime } from '../../src/core/agentRuntime.js';
import AgentOS from '../../src/core/AgentOS.js';
import { AgentHarness } from '../../src/harness/AgentHarness.js';

describe('canonical runtime composition', () => {
  test('AgentOS and AgentHarness reuse the shared AgentRuntime', async () => {
    const runtime = getAgentRuntime();
    const os = new AgentOS();
    const harness = new AgentHarness();

    expect(os.runtime).toBe(runtime);

    await harness.start();
    expect(harness._runtime).toBe(runtime);
    expect(harness._registry).toBe(runtime.toolRegistry);

    await harness.stop();
    await os.destroy();
  });
});
