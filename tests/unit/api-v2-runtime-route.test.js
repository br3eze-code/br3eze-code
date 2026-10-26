import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import v2Router from '../../src/api/routes/v2.js';

function makeApp(identity = null) {
  const app = express();
  app.use(express.json());
  if (identity) app.use((req, res, next) => { req.user = identity; next(); });
  app.use('/api/v2', v2Router);
  return app;
}

describe('API v2 uses the canonical AgentRuntime owner', () => {
  beforeEach(() => {
    delete global.agentRuntime;
    delete global.askEngine;
    delete global.ai;
    delete global.coordinator;
  });

  afterEach(() => {
    delete global.agentRuntime;
    delete global.askEngine;
    delete global.ai;
    delete global.coordinator;
  });

  test('routes one-shot ask through runtime.execute rather than legacy engines', async () => {
    const runtime = {
      execute: jest.fn().mockResolvedValue({ response: 'answer', sessionId: 's1' }),
      model: { providerName: 'test' },
    };
    const legacyRun = jest.fn();
    global.agentRuntime = runtime;
    global.askEngine = { run: legacyRun };

    const response = await request(makeApp({ tenantId: 'tenant-1', uid: 'user-1' }))
      .post('/api/v2/ask')
      .send({ prompt: 'hello', sessionId: 's1' })
      .expect(200);

    expect(response.body.data.response).toBe('answer');
    expect(runtime.execute).toHaveBeenCalledWith(expect.objectContaining({
      content: 'hello',
      sessionId: 's1',
      context: expect.objectContaining({ channel: 'api', tenantId: 'tenant-1', userId: 'user-1' }),
    }));
    expect(legacyRun).not.toHaveBeenCalled();
  });

  test('routes SSE ask through runtime.stream rather than a second engine', async () => {
    const runtime = {
      execute: jest.fn(),
      stream: async function* () {
        yield { type: 'text', text: 'hello' };
        yield { type: 'done' };
      },
      model: { providerName: 'test' },
    };
    global.agentRuntime = runtime;
    global.askEngine = { stream: jest.fn() };

    const response = await request(makeApp())
      .post('/api/v2/ask')
      .send({ prompt: 'hello', stream: true })
      .expect(200);

    expect(response.text).toContain('"type":"text"');
    expect(response.text).toContain('"type":"done"');
    expect(global.askEngine.stream).not.toHaveBeenCalled();
  });

  test('routes multi-turn chat through AgentRuntime with authenticated scope', async () => {
    const runtime = {
      model: { providerName: 'test' },
      execute: jest.fn().mockResolvedValue({ response: 'chat answer' }),
    };
    global.agentRuntime = runtime;

    const response = await request(makeApp())
      .post('/api/v2/chat')
      .send({ messages: [{ role: 'user', content: 'hello' }], systemPrompt: 'Be concise.' })
      .expect(200);

    expect(response.body.data.response).toBe('chat answer');
    expect(runtime.execute).toHaveBeenCalledWith(expect.objectContaining({
      content: 'hello',
      context: expect.objectContaining({ systemPrompt: 'Be concise.', channel: 'api' }),
    }));
  });

  test('does not treat a legacy askEngine alias as the runtime owner', async () => {
    global.askEngine = { run: jest.fn(), stream: jest.fn(), model: { providerName: 'legacy' } };

    await request(makeApp())
      .post('/api/v2/ask')
      .send({ prompt: 'hello' })
      .expect(503);

    expect(global.askEngine.run).not.toHaveBeenCalled();
  });
});
