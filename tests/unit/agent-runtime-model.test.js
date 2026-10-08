import { describe, expect, test, jest } from '@jest/globals';
import { AgentRuntime } from '../../src/core/agentRuntime.js';

describe('AgentRuntime model execution path', () => {
  test('executes model tool calls through the injected executor and returns final response', async () => {
    const toolExecutor = jest.fn()
      .mockResolvedValueOnce({ status: 'ok', value: 42 });
    const model = {
      execute: jest.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ id: 'call-1', name: 'system.stats', arguments: { scope: 'host' } }]
        })
        .mockResolvedValueOnce({ content: 'done', toolCalls: [] })
    };

    const runtime = new AgentRuntime({
      model,
      toolExecutor,
      maxTurns: 3
    });

    const result = await runtime.execute({ content: 'show system stats', sessionId: 's1' });

    expect(toolExecutor).toHaveBeenCalledWith('system.stats', { scope: 'host' }, expect.objectContaining({ content: 'show system stats' }));
    expect(model.execute).toHaveBeenCalledTimes(2);
    expect(result.response).toBe('done');
    expect(result.toolsUsed).toEqual([]);
    expect(result.loop.state).toBe('completed');
  });

  test('fails cleanly when model requests tools without an executor', async () => {
    const runtime = new AgentRuntime({
      model: { execute: jest.fn().mockResolvedValue({ toolCalls: [{ id: 'c1', name: 'ping', arguments: {} }] }) },
      maxTurns: 2
    });

    const result = await runtime.execute({ content: 'ping', sessionId: 's2' });

    expect(result.error).toMatch(/No tool executor/);
    expect(result.loop.state).toBe('failed');
  });
});
