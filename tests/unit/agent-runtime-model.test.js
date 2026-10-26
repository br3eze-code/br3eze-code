import { describe, expect, test, jest } from '@jest/globals';
import { AgentRuntime } from '../../src/core/agentRuntime.js';
import { getTaskRegistry, TaskStatus } from '../../src/core/taskRegistry.js';

describe('AgentRuntime model execution path', () => {
  test('allows the host to inject a model port into the existing runtime owner', () => {
    const runtime = new AgentRuntime();
    const model = { execute: async () => ({ content: 'configured' }) };

    expect(runtime.setModel(model)).toBe(runtime);
    expect(runtime.model).toBe(model);
  });

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
    expect(result.toolsUsed).toEqual(['system.stats']);
    expect(result.loop.state).toBe('completed');
  });

  test('allows the composition root to replace infrastructure on the same runtime', () => {
    const runtime = new AgentRuntime();
    const toolRegistry = { execute: jest.fn(), getAllTools: () => [] };

    expect(runtime.setToolRegistry(toolRegistry)).toBe(runtime);
    expect(runtime.toolRegistry).toBe(toolRegistry);
    expect(typeof runtime.toolExecutor).toBe('function');
    runtime.toolExecutor('demo.tool', {}, {});
    expect(toolRegistry.execute).toHaveBeenCalledWith('demo.tool', {}, {});
  });

  test('passes registered tool schemas to the injected model port', async () => {
    const model = {
      execute: jest.fn().mockResolvedValue({ content: 'ready', toolCalls: [] }),
    };
    const toolRegistry = {
      getAllTools: () => [
        {
          fullName: 'demo.lookup',
          description: 'Lookup a demo record',
          schema: {
            description: 'Lookup a demo record',
            parameters: {
              type: 'object',
              properties: { key: { type: 'string' } },
              required: ['key'],
            },
          },
        },
        {
          fullName: 'demo.search',
          schema: {
            parameters: [{ name: 'query', type: 'string', required: true }],
          },
        },
      ],
      execute: jest.fn(),
    };
    const runtime = new AgentRuntime({ model, toolRegistry });

    await runtime.execute({ content: 'lookup a record', sessionId: 'schema-session' });

    expect(model.execute).toHaveBeenCalledWith(expect.objectContaining({
      tools: [
        {
          name: 'demo.lookup',
          description: 'Lookup a demo record',
          parameters: {
            type: 'object',
            properties: { key: { type: 'string' } },
            required: ['key'],
          },
        },
        {
          name: 'demo.search',
          description: '',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'query parameter' } },
            required: ['query'],
          },
        },
      ],
    }));
  });

  test('streams a completed response through the runtime contract', async () => {
    const runtime = new AgentRuntime({
      model: { execute: jest.fn().mockResolvedValue({ content: 'streamed answer', toolCalls: [] }) },
    });
    const events = [];

    for await (const event of runtime.stream('hello', { sessionId: 'stream-session' })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text', text: 'streamed answer', content: 'streamed answer' },
      { type: 'done' },
    ]);
  });

  test('executes registered tools inside an authenticated task scope', async () => {
    const toolRegistry = {
      getAllTools: () => [{
        fullName: 'demo.echo',
        schema: { description: 'Echo a value', parameters: { type: 'object', properties: { value: { type: 'string' } } } },
      }],
      getTool: (name) => ({ fullName: name, capability: { requiresApproval: false } }),
      execute: jest.fn().mockResolvedValue({ echoed: 'ok' }),
    };
    const model = {
      execute: jest.fn()
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [{ id: 'call-task-1', name: 'demo.echo', arguments: { value: 'ok' } }],
        })
        .mockResolvedValueOnce({ content: 'done', toolCalls: [] }),
    };
    const runtime = new AgentRuntime({ model, toolRegistry });
    const result = await runtime.execute({
      content: 'echo ok',
      sessionId: 'task-scoped-session',
      context: { tenantId: 'tenant-test', userId: 'user-test' },
    });

    expect(result.response).toBe('done');
    expect(toolRegistry.execute).toHaveBeenCalledWith(
      'demo.echo',
      { value: 'ok' },
      expect.objectContaining({
        tenantId: 'tenant-test',
        userId: 'user-test',
        action: 'demo.echo',
        phase: 'execute',
        taskId: expect.any(String),
      }),
    );
    const taskId = toolRegistry.execute.mock.calls[0][2].taskId;
    expect(getTaskRegistry().get(taskId).status).toBe(TaskStatus.COMPLETED);
  });

  test('fails cleanly when model requests tools without an executor', async () => {
    const runtime = new AgentRuntime({
      model: { execute: jest.fn().mockResolvedValue({ toolCalls: [{ id: 'c1', name: 'ping', arguments: {} }] }) },
      toolRegistry: { getToolsForLLM: () => [], getAllTools: () => [] },
      maxTurns: 2
    });

    const result = await runtime.execute({ content: 'ping', sessionId: 's2' });

    expect(result.error).toMatch(/No tool executor/);
    expect(result.loop.state).toBe('failed');
  });
});
