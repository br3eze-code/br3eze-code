export class UsageMeter {
  constructor({ sink = null } = {}) { this.sink = sink; this.records = []; }
  record({ executionId, tenantId, provider = null, model = null, inputTokens = 0, outputTokens = 0, latencyMs = 0, cost = 0, metadata = {} } = {}) {
    if (!tenantId) throw new Error('tenantId is required for usage accounting');
    const record = Object.freeze({ executionId: executionId || null, tenantId, provider, model, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, latencyMs, cost, metadata: structuredClone(metadata), recordedAt: new Date().toISOString() });
    this.records.push(record);
    this.sink?.(record);
    return record;
  }
  forTenant(tenantId) { return this.records.filter((r) => r.tenantId === tenantId); }
  summarize(tenantId) {
    return this.forTenant(tenantId).reduce((summary, record) => ({
      requests: summary.requests + 1,
      inputTokens: summary.inputTokens + record.inputTokens,
      outputTokens: summary.outputTokens + record.outputTokens,
      totalTokens: summary.totalTokens + record.totalTokens,
      latencyMs: summary.latencyMs + record.latencyMs,
      cost: summary.cost + Number(record.cost || 0),
    }), { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0, cost: 0 });
  }
}

export default UsageMeter;
