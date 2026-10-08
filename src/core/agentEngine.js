/**
 * Compatibility facade for the retired AgentEngine.
 *
 * Runtime execution ownership lives in AgentRuntime/RuntimeSession.
 * This module preserves the historical API without maintaining a second
 * execution engine, transcript, permission state, or session representation.
 */
import EventEmitter from 'node:events';
import { RuntimeSession, TurnResult, UsageSummary } from './agentRuntime.js';

const DEFAULT_CONFIG = Object.freeze({
  maxTurns: 8,
  maxBudgetTokens: 4000,
  compactAfterTurns: 12,
  structuredOutput: false,
  permissionMode: 'prompt'
});

class AgentEngine extends EventEmitter {
  constructor(config = {}, sessionId = null, session = null) {
    super();
    this._session = session || RuntimeSession.create({
      prompt: '',
      matchedTools: [],
      permissionDenials: [],
      config: { ...DEFAULT_CONFIG, ...config },
      sessionId
    });
  }

  static create(config = {}) {
    return new AgentEngine(config);
  }

  static fromSession(sessionId, config = {}) {
    return new AgentEngine(config, sessionId, RuntimeSession.fromSession(sessionId, {
      prompt: '',
      matchedTools: [],
      permissionDenials: [],
      config: { ...DEFAULT_CONFIG, ...config }
    }));
  }

  get sessionId() { return this._session.sessionId; }
  get messages() { return this._session.messages; }
  set messages(value) { this._session.messages = [...value]; }
  get permissionDenials() { return this._session.permissionDenials; }
  get totalUsage() { return this._session.totalUsage; }
  get transcriptStore() { return this._session.transcriptStore; }
  get enforcer() { return this._session.enforcer; }
  get config() { return this._session.config; }

  async submitMessage(prompt, toolNames = [], deniedTools = []) {
    const turn = await this._session.submitMessage(prompt, toolNames, deniedTools);
    this.emit('turn', turn);
    return turn;
  }

  async *streamSubmitMessage(prompt, toolNames = [], deniedTools = []) {
    yield { type: 'message_start', sessionId: this.sessionId, prompt };
    if (toolNames.length) yield { type: 'tool_match', tools: toolNames };
    if (deniedTools.length) yield { type: 'permission_denial', denials: deniedTools.map(d => d.toolName) };
    const result = await this.submitMessage(prompt, toolNames, deniedTools);
    yield { type: 'message_delta', text: result.output };
    yield { type: 'message_stop', usage: result.usage.toJSON(), stopReason: result.stopReason, transcriptSize: this.transcriptStore.size };
  }

  persistSession() { return this._session.persistSession(); }
  renderSummary() { return this._session.renderSummary(); }
}

export { AgentEngine, TurnResult, UsageSummary };
