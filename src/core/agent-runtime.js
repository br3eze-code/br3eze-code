/**
 * Legacy AgentRuntime compatibility adapter.
 *
 * Canonical execution lives in ./agentRuntime.js. This file only translates
 * the historical provider/session/safety constructor into the canonical
 * runtime boundary.
 */
import { AgentRuntime as CanonicalAgentRuntime } from './agentRuntime.js';
import { validateRuntime, createRuntimeRequest, AGENT_RUNTIME_CONTRACT_VERSION } from './agentKernel.js';

export class AgentRuntime extends CanonicalAgentRuntime {
  constructor(options = {}) {
    super(options);
    this.runtimeId = options.runtimeId || 'agent-runtime';
    this._legacySessionManager = options.sessionManager || null;
    this._legacyMemoryStore = options.memoryStore || null;
    validateRuntime(this);
  }

  async executeTurn(request) {
    const normalized = createRuntimeRequest(request);
    const result = await this.execute({
      ...normalized.context,
      content: normalized.input,
      sessionId: normalized.sessionId,
      checkpoint: normalized.checkpoint,
      capabilities: normalized.capabilities,
    });
    return {
      contractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
      runtimeId: this.runtimeId,
      sessionId: normalized.sessionId,
      checkpoint: { completedAt: Date.now(), iterations: result.iterations },
      result,
    };
  }
}

export default AgentRuntime;
