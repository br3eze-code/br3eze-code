import { resolveModel, getModelPolicy } from '../../src/core/model-router.js';
import { processChannelMessage } from '../../src/core/channel-runtime.js';

describe('universal AgentOS runtime', () => {
  test('routes task classes through one model policy', () => {
    expect(resolveModel({ task: 'coding' })).toBe(getModelPolicy().defaults.reasoning);
    expect(resolveModel({ task: 'classification' })).toBe(getModelPolicy().defaults.fast);
    expect(resolveModel({ task: 'vision' })).toBe(getModelPolicy().defaults.multimodal);
    expect(resolveModel({ task: 'execution' })).toBe(getModelPolicy().defaults.balanced);
    expect(resolveModel({ task: 'execution', override: 'custom-model' })).toBe('custom-model');
  });

  test.each(['telegram', 'whatsapp', 'web', 'api', 'cli', 'pwa', 'websocket'])('normalizes %s into the same execution boundary', async (channel) => {
    const agent = {
      async processInteraction(message, context) {
        expect(message.text).toBe('hello');
        expect(context.channel).toBe(channel);
        expect(context.model).toBeTruthy();
        expect(context.wbs).toBeInstanceOf(Array);
        expect(context.onboardingSteps).toContain('complete');
        return { success: true, result: { text: 'ok' } };
      },
    };

    const { frame } = await processChannelMessage({
      agent,
      message: { text: 'hello', userId: 'test-user' },
      context: { channel, userId: 'test-user', task: 'execution' },
    });

    expect(frame.channel).toBe(channel);
    expect(frame.wbsPrompt).toBeTruthy();
  });
});
