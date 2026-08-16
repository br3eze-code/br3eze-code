import ModelGateway from '../src/core/model-gateway.js';

describe('ModelGateway', () => {
  const provider = async ({ model }) => ({
    text: `ok:${model}`,
    usage: { inputTokens: 1000, outputTokens: 250 },
  });

  test('routes general workloads to the lowest-cost available model', async () => {
    const gateway = new ModelGateway({ providers: {
      'gemini-3.5-flash-lite': provider,
      'gemini-2.0-flash': provider,
    } });
    const result = await gateway.complete({ tenantId: 'tenant-a', messages: [{ role: 'user', content: 'hello' }] });
    expect(result.model).toBe('gemini-3.5-flash-lite');
    expect(result.usage.inputTokens).toBe(1000);
    expect(result.usage.outputTokens).toBe(250);
  });

  test('records usage and redacts sensitive metadata', async () => {
    const events = [];
    const gateway = new ModelGateway({ providers: { 'gemini-2.0-flash': provider }, eventSink: (event) => events.push(event) });
    await gateway.complete({
      tenantId: 'tenant-b',
      preferredModel: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'network status' }],
      metadata: { channel: 'desktop', apiKey: 'secret', siteId: 'site-1' },
    });
    expect(gateway.getUsage('tenant-b').requests).toBe(1);
    expect(events[0].metadata).toEqual({ channel: 'desktop', apiKey: '[REDACTED]', siteId: 'site-1' });
  });

  test('fails closed when a tenant budget is exceeded', async () => {
    const gateway = new ModelGateway({
      providers: { 'gemini-2.0-flash': provider },
      limits: { business: { monthlyUsd: 0, dailyRequests: 1 } },
    });
    await expect(gateway.complete({ tenantId: 'tenant-c', preferredModel: 'gemini-2.0-flash', messages: [{ content: 'x' }] }))
      .rejects.toMatchObject({ code: 'MODEL_BUDGET_EXCEEDED' });
  });
});
