import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import { TranscriptStore } from './transcript.js';
import { saveSession, loadSession } from './sessionStore.js';
import { PermissionMode, PermissionDenial, PermissionEnforcer } from './permissions.js';
import { getTaskRegistry, TaskStatus } from './taskRegistry.js';
import { logger } from './logger.js';
import { formatWbsForPrompt } from './action-wbs.js';
import { WorkGraph, WorkStatus } from '../workgraph/workGraph.js';
import { ExecutionRecord } from '../workgraph/executionRecord.js';
import { VerificationEngine } from '../verification/verificationEngine.js';
import { AgentLoop, TURN_STATES } from './agent-loop.js';
import { validateModelPort, createModelRequest } from './ports/model.js';

/** Domain-neutral execution runtime. Tool discovery/execution is supplied by adapters. */
const DEFAULT_TOOL_MANIFEST = [
  { name: 'agent.run', keywords: ['agent', 'run', 'execute'] },
  { name: 'workflow.run', keywords: ['workflow', 'flow', 'process'] },
  { name: 'tool.execute', keywords: ['tool', 'execute', 'action'] },
  { name: 'task.status', keywords: ['task', 'status', 'progress'] },
  { name: 'system.status', keywords: ['status', 'health', 'state'] },
  { name: 'users.active', keywords: ['active', 'users', 'user'] },
  { name: 'users.all', keywords: ['all', 'users', 'user'] },
  { name: 'system.stats', keywords: ['system', 'stats', 'statistics', 'resource', 'resources', 'memory', 'cpu'] },
  { name: 'system.logs', keywords: ['system', 'logs', 'log'] },
  { name: 'system.reboot', keywords: ['reboot', 'restart'] },
  { name: 'user.add', keywords: ['create', 'new', 'user', 'add', 'register', 'account'] },
  { name: 'user.remove', keywords: ['remove', 'delete', 'user', 'account'] },
  { name: 'user.status', keywords: ['status', 'user', 'account', 'session'] },
  { name: 'ping', keywords: ['ping', 'latency', 'reach', 'reachable'] },
  { name: 'traceroute', keywords: ['trace', 'traceroute', 'route', 'path', 'hop'] },
  { name: 'firewall.list', keywords: ['firewall', 'rules', 'filter', 'list'] },
  { name: 'firewall.block', keywords: ['block', 'ban', 'blacklist', 'deny'] },
  { name: 'firewall.unblock', keywords: ['unblock', 'unban', 'whitelist', 'allow'] },
  { name: 'interface.list', keywords: ['interface', 'port', 'network'] }
];
export const TOOL_MANIFEST = DEFAULT_TOOL_MANIFEST;
function scorePrompt(tokens, entry) { return entry.keywords.filter(k => tokens.has(k)).length; }

class UsageSummary {
  constructor(inputTokens = 0, outputTokens = 0) { this.inputTokens = inputTokens; this.outputTokens = outputTokens; }
  get total() { return this.inputTokens + this.outputTokens; }
  addTurn(prompt, output) { return new UsageSummary(this.inputTokens + String(prompt).split(/\s+/).filter(Boolean).length, this.outputTokens + String(output).split(/\s+/).filter(Boolean).length); }
  toJSON() { return { inputTokens: this.inputTokens, outputTokens: this.outputTokens }; }
}

class TurnResult {
  constructor({ prompt, output, matchedTools = [], permissionDenials = [], usage, stopReason = 'completed' }) { Object.assign(this, { prompt, output, matchedTools, permissionDenials, usage, stopReason, timestamp: new Date().toISOString() }); }
  toJSON() { return { prompt: this.prompt, output: this.output, matchedTools: this.matchedTools, permissionDenials: this.permissionDenials.map(d => d.toJSON?.() ?? d), usage: this.usage.toJSON(), stopReason: this.stopReason, timestamp: this.timestamp }; }
}

class RuntimeSession {
  constructor({ prompt, matchedTools, permissionDenials, taskId = null, loop = null, config = {}, sessionId = null, stored = null }) {
    this.prompt = prompt; this.sessionId = sessionId || crypto.randomUUID().replace(/-/g, ''); this.matchedTools = matchedTools; this.permissionDenials = permissionDenials; this.taskId = taskId; this.loop = loop; this.createdAt = new Date().toISOString();
    this.config = Object.freeze({ maxTurns: 8, maxBudgetTokens: 4000, compactAfterTurns: 12, ...config });
    this.messages = [...(stored?.messages || [])]; this.totalUsage = new UsageSummary(stored?.inputTokens || 0, stored?.outputTokens || 0);
    this.transcriptStore = new TranscriptStore({ entries: [...this.messages] }); this.enforcer = new PermissionEnforcer(this.config.permissionMode);
  }
  static create(options) { return new RuntimeSession(options); }
  static fromSession(sessionId, options = {}) { return new RuntimeSession({ ...options, sessionId, stored: loadSession(sessionId) }); }
  async submitMessage(prompt, toolNames = [], deniedTools = []) {
    if (this.messages.length >= this.config.maxTurns) return new TurnResult({ prompt, output: `Max turns (${this.config.maxTurns}) reached before processing prompt.`, matchedTools: toolNames, permissionDenials: deniedTools, usage: this.totalUsage, stopReason: 'max_turns_reached' });
    const finalDenials = [...deniedTools], allowedTools = [];
    for (const toolName of toolNames) { const result = this.enforcer.check(toolName); if (!result.allowed) finalDenials.push(new PermissionDenial(toolName, result.reason)); else allowedTools.push(toolName); }
    const toolOutputs = [];
    for (const toolName of allowedTools) {
      if (!this.config.toolExecutor) { toolOutputs.push({ tool: toolName, error: 'No tool executor configured' }); continue; }
      try { toolOutputs.push({ tool: toolName, result: await this.config.toolExecutor(toolName) }); } catch (err) { toolOutputs.push({ tool: toolName, error: err.message }); }
    }
    const lines = [`Prompt: ${prompt}`, toolOutputs.length ? `Tools executed: ${allowedTools.join(', ')}` : 'No tools executed', ...toolOutputs.map(t => t.error ? `  ✗ ${t.tool}: ${t.error}` : `  ✓ ${t.tool}: ${JSON.stringify(t.result).slice(0, 120)}`), finalDenials.length ? `Permission denials: ${finalDenials.map(d => d.toolName).join(', ')}` : null].filter(Boolean);
    const output = lines.join('\n'), projectedUsage = this.totalUsage.addTurn(prompt, output), stopReason = projectedUsage.total > this.config.maxBudgetTokens ? 'max_budget_reached' : 'completed';
    this.messages.push(prompt); this.transcriptStore.append(prompt); this.permissionDenials.push(...finalDenials); this.totalUsage = projectedUsage; this._compactIfNeeded();
    return new TurnResult({ prompt, output, matchedTools: allowedTools, permissionDenials: finalDenials, usage: this.totalUsage, stopReason });
  }
  persistSession() { this.transcriptStore.flush(); return saveSession({ sessionId: this.sessionId, messages: [...this.messages], inputTokens: this.totalUsage.inputTokens, outputTokens: this.totalUsage.outputTokens, createdAt: this.createdAt, updatedAt: new Date().toISOString() }); }
  _compactIfNeeded() { if (this.messages.length > this.config.compactAfterTurns) { this.messages = this.messages.slice(-this.config.compactAfterTurns); this.transcriptStore.compact(this.config.compactAfterTurns); } }
  renderSummary() { return [`Session: ${this.sessionId}`, `Turns: ${this.messages.length} / ${this.config.maxTurns}`, `Usage: in=${this.totalUsage.inputTokens} out=${this.totalUsage.outputTokens}`, `Denials: ${this.permissionDenials.length}`, `Mode: ${this.config.permissionMode}`, `Transcript flushed: ${this.transcriptStore.flushed}`].join('\n'); }
  asMarkdown() { return ['# Runtime Session','',`Prompt: ${this.prompt}`,`Session ID: ${this.sessionId}`,'','## Matched Tools',...(this.matchedTools.length ? this.matchedTools.map(t => `- ${t}`) : ['- none']),'','## Permission Denials',...(this.permissionDenials.length ? this.permissionDenials.map(d => `- ${d.toolName}: ${d.reason}`) : ['- none']),'','## Agent State',this.renderSummary(),...(this.taskId ? [`Task ID: ${this.taskId}`] : [])].join('\n'); }
}

class AgentRuntime extends EventEmitter {
  constructor(config = {}) {
    super();
    this.defaultConfig = { permissionMode: config.permissionMode || PermissionMode.PROMPT, maxTurns: config.maxTurns || 8, maxBudgetTokens: config.maxBudgetTokens || 4000, compactAfterTurns: config.compactAfterTurns || 12 };
    this.toolManifest = Array.isArray(config.toolManifest) ? config.toolManifest : DEFAULT_TOOL_MANIFEST;
    this.toolRegistry = config.toolRegistry || null;
    this.providerManager = config.providerManager || null;
    this.safetyEnvelope = config.safetyEnvelope || null;
    this.sessionManager = config.sessionManager || null;
    this.memoryStore = config.memoryStore || null;
    this.toolExecutor = typeof config.toolExecutor === 'function'
      ? config.toolExecutor
      : this.toolRegistry?.execute?.bind(this.toolRegistry) || null;
    this.verificationEngine = config.verificationEngine || new VerificationEngine(config.verificationChecks || {});
    this.model = config.model || (this.providerManager ? { execute: (messages, tools) => this.providerManager.execute(messages, tools) } : null);
    if (this.model) validateModelPort(this.model);
  }

  routePrompt(prompt, limit = 5) {
    const tokens = new Set(prompt.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
    return this.toolManifest.map(entry => ({ name: entry.name, score: scorePrompt(tokens, entry) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.name);
  }

  async bootstrapSession(prompt, { sessionId = null, permissionMode = null, context = {}, wbs = null } = {}) {
    const config = { ...this.defaultConfig, permissionMode: permissionMode || this.defaultConfig.permissionMode, toolExecutor: this.toolExecutor };
    const wbsText = wbs?.length ? `\n\n## Work Breakdown State\n${formatWbsForPrompt(wbs)}` : '';
    const promptWithWbs = `${prompt}${wbsText}`, matchedTools = this.routePrompt(promptWithWbs);
    const session = sessionId ? RuntimeSession.fromSession(sessionId, { prompt: promptWithWbs, matchedTools, permissionDenials: [], config }) : RuntimeSession.create({ prompt: promptWithWbs, matchedTools, permissionDenials: [], config });
    session.permissionDenials = this._inferDenials(matchedTools, session);
    session.loop = new AgentLoop({ maxRetries: Math.max(0, Math.min(2, (config.maxTurns || 8) - 1)) });
    logger.info(`AgentRuntime bootstrap — capabilities: [${matchedTools.join(', ')}] denials: ${session.permissionDenials.length}`);
    this.emit('session:created', session); return session;
  }

  async execute(frame = {}) {
    if (!frame || frame.content == null) throw new TypeError('AgentRuntime.execute requires frame.content');
    if (!this.model) {
      const { results } = await this.runTurnLoop(String(frame.content), {
        sessionId: frame.sessionId || null,
        permissionMode: frame.permissionMode || null,
        context: frame,
        wbs: frame.wbs || null,
      });
      const last = results.at(-1);
      return { response: last?.output || '', sessionId: last?.sessionId || null, iterations: results.length, toolsUsed: last?.matchedTools || [] };
    }
    return this._executeModelTurn(frame);
  }

  async _executeModelTurn(frame) {
    const sessionId = frame.sessionId || this.sessionManager?.getSessionId?.(frame) || null;
    const loaded = !Array.isArray(frame.messages) && sessionId && this.sessionManager?.load
      ? await this.sessionManager.load(sessionId)
      : [];
    const messages = Array.isArray(frame.messages)
      ? [...frame.messages]
      : [...loaded, { role: 'user', content: String(frame.content) }];
    const tools = Array.isArray(frame.tools) ? frame.tools : this.toolRegistry?.getToolsForLLM?.() || this.toolManifest;
    const loop = new AgentLoop({ maxRetries: Math.max(0, Math.min(2, this.defaultConfig.maxTurns - 1)) });
    loop.transition(TURN_STATES.UNDERSTANDING);
    loop.transition(TURN_STATES.PLANNING, { toolCount: tools.length });
    const allToolsUsed = [];

    for (let iteration = 1; iteration <= this.defaultConfig.maxTurns; iteration += 1) {
      loop.transition(TURN_STATES.EXECUTING, { iteration });
      const response = await this.model.execute(createModelRequest({
        messages,
        tools,
        context: frame.context || frame,
        signal: frame.signal || null,
      }));
      const toolCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
      allToolsUsed.push(...toolCalls.map(call => String(call.name || '').replace(/__/g, '.')).filter(Boolean));
      loop.transition(TURN_STATES.OBSERVING, { iteration, toolCalls: toolCalls.length });
      loop.transition(TURN_STATES.EVALUATING, { iteration });

      if (!toolCalls.length) {
        const output = response?.content ?? response?.text ?? '';
        messages.push({ role: 'assistant', content: output });
        loop.transition(TURN_STATES.VERIFYING, { iteration });
        loop.transition(TURN_STATES.COMPLETED, { iteration });
        await this._persistTurn(sessionId, messages, frame, output, []);
        return { response: output, sessionId, iterations: iteration, toolsUsed: [...new Set(allToolsUsed)], toolCalls: [], raw: response, loop: loop.snapshot() };
      }

      if (typeof this.toolExecutor !== 'function') {
        loop.transition(TURN_STATES.FAILED, { reason: 'No tool executor configured' });
        return { response: response?.content ?? '', sessionId, iterations: iteration, toolsUsed: [], toolCalls, error: 'No tool executor configured', raw: response, loop: loop.snapshot() };
      }

      messages.push({ role: 'assistant', content: response?.content || '', toolCalls });
      const toolsUsed = [];
      for (const call of toolCalls) {
        const name = String(call.name || '').replace(/__/g, '.');
        let args = call.arguments || {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        try {
          const result = await this.toolExecutor(name, args, frame);
          toolsUsed.push(name);
          messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
        } catch (error) {
          messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: error.message }) });
        }
      }

      if (iteration >= this.defaultConfig.maxTurns) {
        loop.transition(TURN_STATES.FAILED, { reason: 'max_turns_reached' });
        await this._persistTurn(sessionId, messages, frame, response?.content ?? '', allToolsUsed);
        return { response: response?.content ?? '', sessionId, iterations: iteration, toolsUsed: [...new Set(allToolsUsed)], toolCalls, stopReason: 'max_turns_reached', raw: response, loop: loop.snapshot() };
      }
      loop.transition(TURN_STATES.RETRYING, { reason: 'tool_calls_pending', iteration });
    }

    throw new Error('Agent model loop exited unexpectedly');
  }

  async runTurnLoop(prompt, opts = {}) {
    const session = await this.bootstrapSession(prompt, opts);
    const { matchedTools, permissionDenials } = session;
    const turns = opts.maxTurns || this.defaultConfig.maxTurns;
    const results = [];
    const promptWithWbs = opts.wbs?.length ? `${prompt}\n\n## Work Breakdown State\n${formatWbsForPrompt(opts.wbs)}` : prompt;
    for (let i = 0; i < turns; i++) {
      if (i === 0) {
        session.loop.transition(TURN_STATES.UNDERSTANDING, { turn: i + 1 });
        session.loop.transition(TURN_STATES.PLANNING, { matchedTools });
      }
      session.loop.transition(TURN_STATES.EXECUTING, { turn: i + 1 });
      const result = await session.submitMessage(i === 0 ? promptWithWbs : `${promptWithWbs} [turn ${i + 1}]`, matchedTools, permissionDenials);
      session.loop.transition(TURN_STATES.OBSERVING, { stopReason: result.stopReason });
      session.loop.transition(TURN_STATES.EVALUATING, { turn: i + 1 });
      results.push(result); this.emit('turn', result);
      if (result.stopReason !== 'completed') {
        if (i + 1 < turns && session.loop.retryCount < session.loop.maxRetries) {
          session.loop.transition(TURN_STATES.RETRYING, { stopReason: result.stopReason });
          continue;
        }
        session.loop.transition(TURN_STATES.FAILED, { stopReason: result.stopReason });
        break;
      }
      session.loop.transition(TURN_STATES.VERIFYING, { turn: i + 1 });
      session.loop.transition(TURN_STATES.COMPLETED, { turn: i + 1 });
      break;
    }
    const sessionPath = session.persistSession();
    return { results, session, sessionPath };
  }

  async executeWorkGraph(graph, { agentId = null, executor = null, verify = true } = {}) {
    if (!(graph instanceof WorkGraph)) throw new TypeError('executeWorkGraph requires a WorkGraph');
    const records = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const task of graph.ready()) {
        progressed = true;
        graph.transition(task.id, WorkStatus.RUNNING);
        const record = new ExecutionRecord({ taskId: task.id, agentId });
        record.start();
        try {
          const run = executor || (async current => {
            if (current.tool) return this.executeTool(current.tool, current.args || {});
            if (typeof current.run === 'function') return current.run(current);
            return { status: 'completed', taskId: current.id };
          });
          const result = await run(task);
          if (result?.evidence) record.addEvidence(result.evidence);
          if (result?.artifacts) for (const artifact of result.artifacts) record.addArtifact(artifact);
          const verification = verify && task.verification?.length
            ? await this.verificationEngine.verify(result, task.verification)
            : null;
          if (verification && !verification.passed) throw Object.assign(new Error('Task verification failed'), { verification });
          record.succeed(result);
          if (record.evidence.length) graph.attachEvidence(task.id, record.evidence);
          graph.transition(task.id, WorkStatus.COMPLETED, { result });
        } catch (error) {
          record.fail(error);
          graph.transition(task.id, WorkStatus.FAILED, { reason: error.message });
        }
        records.push(record);
      }
    }
    return { graph, records, summary: graph.summary() };
  }

  async dispatchTask(prompt, opts = {}) {
    const registry = getTaskRegistry();
    const task = registry.create(prompt, { description: opts.description, action: opts.action || 'assist.task', owner: { userId: opts.context?.userId || null, platformId: opts.context?.platformId || null }, context: opts.context || {}, wbs: opts.wbs || null });
    registry.setStatus(task.taskId, TaskStatus.RUNNING); this.emit('task:dispatched', task);
    this._executeTask(task.taskId, prompt, opts).catch(err => { registry.setStatus(task.taskId, TaskStatus.FAILED, err.message); logger.error(`Task ${task.taskId} failed:`, err.message); });
    return task;
  }

  async _executeTask(taskId, prompt, opts) {
    const registry = getTaskRegistry();
    const { results } = await this.runTurnLoop(prompt, { ...opts, wbs: opts.wbs || registry.get(taskId)?.wbs, context: opts.context || registry.get(taskId)?.scope || {} });
    for (const r of results) registry.appendOutput(taskId, 'assistant', r.output);
    const last = results[results.length - 1];
    registry.setStatus(taskId, last?.stopReason === 'completed' ? TaskStatus.COMPLETED : TaskStatus.FAILED);
  }

  _inferDenials(toolNames, engine) { return toolNames.flatMap(name => { const check = engine.enforcer.check(name); return check.allowed ? [] : [new PermissionDenial(name, check.reason)]; }); }
  async _persistTurn(sessionId, messages, frame, output, toolsUsed) {
    if (!sessionId) return;
    if (this.sessionManager?.save) await this.sessionManager.save(sessionId, messages.slice(-20));
    if (this.memoryStore?.append) {
      await this.memoryStore.append(sessionId, {
        timestamp: Date.now(),
        input: frame.content,
        output,
        toolsUsed: toolsUsed.length,
      });
    }
  }

  async executeTool(toolName, params = {}, context = {}) {
    if (!this.toolRegistry) {
      if (!this.toolExecutor) throw new Error('No tool executor configured');
      return this.toolExecutor(toolName, params, context);
    }
    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) throw new Error(`Tool not found: ${toolName}`);
    if (this.safetyEnvelope?.checkToolExecution && !this.safetyEnvelope.checkToolExecution(toolName, params)) {
      throw new Error(`Tool execution blocked by safety envelope: ${toolName}`);
    }
    return this.toolRegistry.execute(toolName, params, context);
  }

  listTools() { return this.toolRegistry?.getAllTools?.().map(t => t.fullName || t.name) || this.toolManifest.map(t => t.name); }
  findTools(query) { const needle = query.toLowerCase(); return this.toolManifest.filter(t => t.name.includes(needle) || t.keywords.some(k => k.includes(needle))).map(t => t.name); }
}

let _runtime = null;
function getAgentRuntime(config = {}) { if (!_runtime) _runtime = new AgentRuntime(config); return _runtime; }
export { AgentRuntime, RuntimeSession, TurnResult, UsageSummary, getAgentRuntime };
export default { AgentRuntime, RuntimeSession, getAgentRuntime, TOOL_MANIFEST };
