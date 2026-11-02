import { getAgentRuntime } from './agentRuntime.js';

/**
 * Compatibility facade for the retired AskEngine API.
 *
 * All model calls, tool discovery, approvals, and execution are delegated to
 * AgentRuntime. This class deliberately contains no provider client, ReAct
 * loop, direct domain service access, or duplicate tool registry.
 */
export class AskEngine {
  constructor({ runtime, ...legacyDependencies } = {}) {
    this.runtime = runtime || getAgentRuntime();
    if (!this.runtime || typeof this.runtime.execute !== 'function') {
      throw new TypeError('AskEngine requires the canonical AgentRuntime');
    }
    // Keep legacy dependencies visible for diagnostics only. They are not
    // executed directly; register their capabilities as runtime tools instead.
    this.legacyDependencies = Object.freeze(Object.keys(legacyDependencies));
  }

  async run(prompt, context = {}) {
    const result = await this.runtime.run(String(prompt ?? ''), context);
    const response = result?.response ?? result?.content ?? '';
    const text = typeof response === 'string' ? response : JSON.stringify(response);
    return {
      ...result,
      type: Array.isArray(result?.toolsUsed) && result.toolsUsed.length ? 'ai_act' : 'ai_chat',
      text,
    };
  }

  processQuery(prompt, context = {}) {
    return this.run(prompt, context);
  }

  executeTool(name, params = {}, context = {}) {
    if (typeof this.runtime.executeTool !== 'function') {
      throw new TypeError('Canonical runtime does not expose executeTool()');
    }
    return this.runtime.executeTool(name, params, context);
  }

  getAvailableTools() {
    return this.runtime.listTools?.() || [];
  }

  getCapabilityManifest() {
    return this.runtime.getCapabilityManifest?.() || { version: '1.0', tools: [] };
  }
}

export default AskEngine;
