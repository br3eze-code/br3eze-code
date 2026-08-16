import EventEmitter from 'node:events';
import { logger } from './logger.js';

const DEFAULT_PRICING = Object.freeze({
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
});

const DEFAULT_LIMITS = Object.freeze({
  business: { monthlyUsd: 100, dailyRequests: 5000 },
  pro_fleet: { monthlyUsd: 1000, dailyRequests: 50000 },
  enterprise: { monthlyUsd: Infinity, dailyRequests: Infinity },
});

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

/**
 * Secure model routing boundary for AgentOS.
 *
 * The gateway owns model selection, tenant budgets, normalized usage events,
 * redacted request metadata, and provider failure handling. Provider adapters
 * are injected so the core remains domain-agnostic and testable.
 */
export class ModelGateway extends EventEmitter {
  constructor({ providers = {}, pricing = {}, limits = {}, eventSink = null, clock = () => new Date() } = {}) {
    super();
    this.providers = providers;
    this.pricing = { ...DEFAULT_PRICING, ...pricing };
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.eventSink = eventSink;
    this.clock = clock;
    this.usage = new Map();
  }

  route({ capability = 'general', plan = 'business', preferredModel, inputTokens = 0, outputTokenBudget = 1024 } = {}) {
    const candidates = preferredModel
      ? [preferredModel]
      : capability === 'vision'
        ? ['gemini-3.7-flash', 'gemini-2.0-flash']
        : capability === 'reasoning'
          ? ['gemini-3.7-flash', 'gemini-2.0-flash']
          : ['gemini-3.5-flash-lite', 'gemini-2.0-flash'];

    const model = candidates.find((candidate) => this.providers[candidate] && this.pricing[candidate]);
    if (!model) throw new Error(`No model provider available for capability: ${capability}`);

    const estimate = this.estimateCost(model, inputTokens, outputTokenBudget);
    return { model, estimateUsd: estimate, plan };
  }

  estimateCost(model, inputTokens = 0, outputTokens = 0) {
    const price = this.pricing[model];
    if (!price) throw new Error(`Unknown model pricing: ${model}`);
    return (finiteNumber(inputTokens) / 1_000_000) * finiteNumber(price.input)
      + (finiteNumber(outputTokens) / 1_000_000) * finiteNumber(price.output);
  }

  _usageKey(tenantId, month = monthKey(this.clock())) {
    return `${tenantId}:${month}`;
  }

  getUsage(tenantId, date = this.clock()) {
    const record = this.usage.get(this._usageKey(tenantId, monthKey(date)));
    return record ? { ...record } : { tenantId, month: monthKey(date), requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  _assertBudget({ tenantId, plan, estimatedCost }) {
    if (!tenantId) throw new Error('tenantId is required for model usage');
    const limits = this.limits[plan] || this.limits.business;
    const usage = this.getUsage(tenantId);
    const today = [...this.usage.values()]
      .filter((record) => record.tenantId === tenantId && record.day === dayKey(this.clock()))
      .reduce((total, record) => total + record.requests, 0);
    if (usage.costUsd + estimatedCost > limits.monthlyUsd || today >= limits.dailyRequests) {
      const error = new Error('Model usage budget exceeded');
      error.code = 'MODEL_BUDGET_EXCEEDED';
      throw error;
    }
  }

  async complete({ tenantId, plan = 'business', capability = 'general', preferredModel, messages, tools, metadata = {}, outputTokenBudget = 1024 } = {}) {
    const safeMessages = Array.isArray(messages) ? messages : [];
    const inputTokens = this._estimateTokens(safeMessages);
    const selected = this.route({ capability, plan, preferredModel, inputTokens, outputTokenBudget });
    this._assertBudget({ tenantId, plan, estimatedCost: selected.estimateUsd });

    const provider = this.providers[selected.model];
    const startedAt = this.clock();
    let response;
    try {
      response = await provider({ model: selected.model, messages: safeMessages, tools, maxTokens: outputTokenBudget, metadata });
    } catch (error) {
      this.emit('provider.error', { model: selected.model, tenantId, code: error.code, message: error.message });
      throw error;
    }

    const usage = {
      inputTokens: finiteNumber(response?.usage?.inputTokens, inputTokens),
      outputTokens: finiteNumber(response?.usage?.outputTokens, this._estimateTokens([response?.text || response?.content || ''])),
    };
    const costUsd = this.estimateCost(selected.model, usage.inputTokens, usage.outputTokens);
    this._recordUsage({ tenantId, plan, model: selected.model, usage, costUsd, startedAt, metadata });
    return { ...response, model: selected.model, usage: { ...usage, costUsd } };
  }

  _recordUsage({ tenantId, plan, model, usage, costUsd, startedAt, metadata }) {
    const now = this.clock();
    const key = this._usageKey(tenantId, monthKey(now));
    const current = this.getUsage(tenantId, now);
    const record = {
      ...current,
      tenantId,
      plan,
      month: monthKey(now),
      day: dayKey(now),
      requests: current.requests + 1,
      inputTokens: current.inputTokens + usage.inputTokens,
      outputTokens: current.outputTokens + usage.outputTokens,
      costUsd: current.costUsd + costUsd,
      updatedAt: now.toISOString(),
    };
    this.usage.set(key, record);
    const event = {
      id: `${tenantId}:${startedAt.getTime()}:${record.requests}`,
      occurredAt: now.toISOString(),
      tenantId,
      plan,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
      metadata: this._redactMetadata(metadata),
    };
    this.emit('usage', event);
    if (this.eventSink) Promise.resolve(this.eventSink(event)).catch((error) => logger.warn(`Usage event sink failed: ${error.message}`));
  }

  _estimateTokens(messages) {
    return messages.reduce((total, message) => {
      const content = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content || '');
      return total + Math.ceil(content.length / 4);
    }, 0);
  }

  _redactMetadata(metadata = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (/token|secret|password|credential|authorization|api[-_]?key/i.test(key)) safe[key] = '[REDACTED]';
      else if (['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
    }
    return safe;
  }
}

export const MODEL_PRICING = DEFAULT_PRICING;
export const MODEL_LIMITS = DEFAULT_LIMITS;
export default ModelGateway;
