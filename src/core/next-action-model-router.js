import { createNextActionProposal, generateNextActionCandidates, validateNextActionProposal } from './next-action-planner.js';

const DEFAULTS = Object.freeze({ timeoutMs: 8000, maxCandidates: 3, minConfidenceForEscalation: 0.75 });

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('Model router timeout'), { code: 'MODEL_ROUTER_TIMEOUT' })), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function redactContext(context = {}) {
  return {
    userId: context.userId || null,
    tenantId: context.tenantId || null,
    domainId: context.domainId || null,
    siteId: context.siteId || null,
    channel: context.channel || null,
    status: context.status || null,
    role: context.role || null,
    authorizedCapabilities: Array.isArray(context.authorizedCapabilities || context.capabilities)
      ? [...(context.authorizedCapabilities || context.capabilities)]
      : [],
    locationPermission: context.locationPermission === true,
    deviceInfo: context.deviceInfo ? {
      platform: context.deviceInfo.platform || null,
      model: context.deviceInfo.model || null,
      networkType: context.deviceInfo.networkType || null,
    } : null,
  };
}

export class NextActionModelRouter {
  constructor({ providers = {}, defaultProvider = null, policy = {} } = {}) {
    this.providers = new Map(Object.entries(providers));
    this.defaultProvider = defaultProvider;
    this.policy = { ...DEFAULTS, ...policy };
  }

  register(name, provider) {
    if (!name || !provider || typeof provider.rankCandidates !== 'function') {
      throw Object.assign(new Error('Provider must expose rankCandidates'), { code: 'MODEL_PROVIDER_INVALID' });
    }
    this.providers.set(name, provider);
    return this;
  }

  async propose({ task = null, context = {}, provider = null, now = Date.now() } = {}) {
    const base = createNextActionProposal({ task, context, now });
    const top = base.candidates[0];
    const selected = provider || this.defaultProvider;
    if (!selected || !this.providers.has(selected) || !top || top.confidence >= this.policy.minConfidenceForEscalation) return { ...base, source: 'deterministic' };

    const adapter = this.providers.get(selected);
    const payload = {
      context: redactContext(context),
      task: {
        taskId: task?.taskId || null,
        action: task?.action || null,
        status: task?.status || null,
        wbs: (task?.wbs || []).map(({ id, key, status, title }) => ({ id, key, status, title })),
      },
      candidates: generateNextActionCandidates({ task, context, now }).slice(0, this.policy.maxCandidates),
    };

    try {
      const ranked = await withTimeout(Promise.resolve(adapter.rankCandidates(payload)), this.policy.timeoutMs);
      const proposal = { ...base, candidates: Array.isArray(ranked) ? ranked.slice(0, this.policy.maxCandidates) : base.candidates, source: selected };
      const validation = validateNextActionProposal(proposal, { task, context, now });
      return { ...proposal, valid: validation.valid, validationErrors: validation.errors };
    } catch (error) {
      return { ...base, source: 'deterministic:fallback', modelError: error.code || 'MODEL_ROUTER_ERROR' };
    }
  }
}

export { redactContext, DEFAULTS as NEXT_ACTION_ROUTER_DEFAULTS };
export default NextActionModelRouter;
