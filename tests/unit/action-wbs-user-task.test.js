import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import { TaskRegistry } from '../../src/core/taskRegistry.js';
import { createActionWbs, completeActionWbsStep, summarizeActionWbs } from '../../src/core/action-wbs.js';
import { NanoAIProvider } from '../../src/core/llm/providers/NanoAIProvider.js';

describe('action WBS and scoped user tasks', () => {
  test('creates deterministic action steps and advances progress', () => {
    const wbs = createActionWbs('research.deep_search', { context: { tenantId: 't1', userId: 'u1' }, input: { text: 'find sources' } });
    expect(wbs).toHaveLength(4);
    expect(wbs[0].status).toBe('running');
    const updated = completeActionWbsStep(wbs, wbs[0].id, 'scoped');
    expect(updated[0].status).toBe('completed');
    expect(updated[1].status).toBe('running');
    expect(summarizeActionWbs(updated).progress).toBe(25);
  });

  test('filters tasks by user and scope', () => {
    const registry = new TaskRegistry();
    const task = registry.create('private task', { action: 'assist.task', context: { tenantId: 't1', domainId: 'd1', siteId: 's1', userId: 'u1' }, owner: { userId: 'u1', platformId: 'telegram:1' } });
    expect(registry.listForUser('u1', { tenantId: 't1', domainId: 'd1', siteId: 's1' })).toHaveLength(1);
    expect(registry.listForUser('u2', { tenantId: 't1', domainId: 'd1', siteId: 's1' })).toHaveLength(0);
    expect(task.scope).toMatchObject({ tenantId: 't1', domainId: 'd1', siteId: 's1', userId: 'u1' });
  });
});

describe('Nano.ai provider', () => {
  beforeEach(() => {
    process.env.NANO_AI_API_KEY = 'test-key';
    process.env.NANO_AI_BASE_URL = 'https://nano.test/v1';
  });

  test('normalizes OpenAI-compatible completion and usage', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok', tool_calls: [] } }], usage: { prompt_tokens: 12, completion_tokens: 7 }, model: 'nano-test' })
    });
    const result = await new NanoAIProvider().generate([{ role: 'user', content: 'hello' }]);
    expect(result).toMatchObject({ text: 'ok', provider: 'nano.ai', model: 'nano-test', usage: { inputTokens: 12, outputTokens: 7 } });
    expect(fetchMock).toHaveBeenCalledWith('https://nano.test/v1/chat/completions', expect.any(Object));
    fetchMock.mockRestore();
  });
});
