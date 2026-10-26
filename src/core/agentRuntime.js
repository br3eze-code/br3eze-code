import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import { TranscriptStore } from './transcript.js';
import { saveSession, loadSession } from './sessionStore.js';
import { PermissionMode, PermissionDenial, PermissionEnforcer } from './permissions.js';
import { getTaskRegistry, TaskStatus, TaskPhase } from './taskRegistry.js';
import { logger } from './logger.js';
import { formatWbsForPrompt } from './action-wbs.js';
import { WorkGraph, WorkStatus } from '../workgraph/workGraph.js';
import { ExecutionRecord } from '../workgraph/executionRecord.js';
import { VerificationEngine } from '../verification/verificationEngine.js';
import { AgentLoop, TURN_STATES } from './agent-loop.js';
import { validateModelPort, createModelRequest } from './ports/model.js';
import toolRegistry from './ToolRegistry.js';
import { PluginRegistry, PluginLoader } from '../sdk/plugin/index.js';
import { ApprovalGate } from './approval-gates.js';

/** Domain-neutral execution runtime. Tool discovery/execution is supplied by adapters. */
const DEFAULT_TOOL_MANIFEST = [
  { name: 'agent.run', keywords: ['agent', 'run', 'execute'] },
  { name: 'workflow.run', keywords: ['workflow', 'flow', 'process'] },
  { name: 'tool.execute', keywords: ['tool', 'execute', 'action'] },
  { name: 'task.status', keywords: ['task', 'status', 'progress'] },
  { name: 'runtime.status', keywords: ['status', 'health', 'state', 'runtime'] },
  { name: 'system.stats', keywords: ['system', 'stats', 'cpu', 'memory'] },
  { name: 'system.reboot', keywords: ['system', 'reboot', 'restart'] },
  { name: 'user.add', keywords: ['user', 'add', 'create', 'register'] },
  { name: 'firewall.block', keywords: ['firewall', 'block', 'ban', 'blacklist'] },
  { name: 'ping', keywords: ['ping', 'latency', 'host'] }
];
export const TOOL_MANIFEST = DEFAULT_TOOL_MANIFEST;

/** Stable request contract owned by the canonical runtime. */
export const AGENT_RUNTIME_CONTRACT_VERSION = '1.0';

export function createRuntimeRequest({ sessionId, input, context = {}, capabilities = [], checkpoint = null } = {}) {
  if (!sessionId) throw new TypeError('sessionId is required');
  if (input === undefined || input === null) throw new TypeError('input is required');
  return Object.freeze({
    contractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    sessionId,
    input,
    context: Object.freeze({ ...context }),
    capabilities: Object.freeze([...capabilities]),
    checkpoint,
  });
}

export function validateRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime must be an object');
  if (typeof runtime.execute !== 'function') throw new TypeError('runtime must implement execute(frame)');
  return runtime;
}

function normalizeToolParameters(parameters) {
  if (Array.isArray(parameters)) {
    const properties = Object.fromEntries(parameters
      .filter((parameter) => parameter?.name)
      .map((parameter) => [parameter.name, {
        type: parameter.type || 'string',
        description: parameter.description || `${parameter.name} parameter`,
      }]));
    const required = parameters.filter((parameter) => parameter?.required && parameter.name).map((parameter) => parameter.name);
    return { type: 'object', properties, ...(required.length ? { required } : {}) };
  }
  if (parameters && typeof parameters === 'object') return parameters;
  return { type: 'object', properties: {} };
}

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
    this.config = Object.freeze({ permissionMode: PermissionMode.PROMPT, maxTurns: 8, maxBudgetTokens: 4000, compactAfterTurns: 12, ...config });
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
    // AgentRuntime owns capability orchestration; registries are implementation stores.
    this.toolRegistry = config.toolRegistry || toolRegistry;
    this.pluginRegistry = config.pluginRegistry || new PluginRegistry();
    this.pluginLoader = config.pluginLoader || new PluginLoader({
      registry: this.pluginRegistry,
      runtime: this,
        logger,
        config,
    });
    this.toolManifest = Array.isArray(config.toolManifest) ? [...config.toolManifest] : [...DEFAULT_TOOL_MANIFEST];
    this.skillRegistry = config.skillRegistry || null;
    this.providerManager = config.providerManager || null;
    this.safetyEnvelope = config.safetyEnvelope || null;
    this.approvalGate = config.approvalGate || new ApprovalGate(config.approvalOptions || {});
    this.sessionManager = config.sessionManager || null;
    this.memoryStore = config.memoryStore || null;
    this.injectedToolExecutor = typeof config.toolExecutor === 'function';
    this.toolExecutor = this.injectedToolExecutor
      ? config.toolExecutor
      : this.toolRegistry?.execute?.bind(this.toolRegistry) || null;
    this.verificationEngine = config.verificationEngine || new VerificationEngine(config.verificationChecks || {});
    this.model = config.model || (this.providerManager ? {
      execute: (request) => this.providerManager.execute(request.messages, request.tools, request.context),
    } : null);
    if (this.model) validateModelPort(this.model);
  }

  /** Inject the host-composed model port without creating a second runtime. */
  setModel(model) {
    this.model = validateModelPort(model);
    return this;
  }

  /** Replace infrastructure at the composition boundary while preserving runtime identity. */
  setToolRegistry(toolRegistry) {
    if (!toolRegistry || typeof toolRegistry !== 'object') {
      throw new TypeError('toolRegistry must be an object');
    }
    this.toolRegistry = toolRegistry;
    this.injectedToolExecutor = false;
    this.toolExecutor = typeof toolRegistry.execute === 'function'
      ? toolRegistry.execute.bind(toolRegistry)
      : null;
    return this;
  }

  getCapabilityManifest() {
  const declarations = this.toolRegistry?.toolDeclarations?.() || [];
  const registeredTools = this.toolRegistry?.getAllTools?.() || [];
  return {
  version: '1.0',
  tools: declarations.length ? declarations : (registeredTools.length ? registeredTools.map(tool => ({
  name: tool.fullName || tool.name,
  description: tool.description || '',
  parameters: normalizeToolParameters(tool.schema?.parameters),
  })) : this.toolManifest || DEFAULT_TOOL_MANIFEST),
      skills: this.toolRegistry?.listSkills?.().map(skill => ({
        name: skill.name,
        description: skill.description || skill.manifest?.description || '',
        version: skill.version || skill.manifest?.version || null,
        enabled: skill.enabled !== false,
      })) || [],
      plugins: this.pluginRegistry?.list?.() || [],
    };
  }

  routePrompt(prompt, limit = 5) {
    const tokens = new Set(String(prompt).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const registeredTools = this.toolRegistry?.getAllTools?.() || [];
  const manifest = registeredTools.length
  ? [
    ...(this.toolManifest || DEFAULT_TOOL_MANIFEST),
    ...registeredTools.map(tool => ({
      name: tool.fullName || tool.name,
      keywords: tool.keywords || String(tool.description || '').toLowerCase().split(/\s+/).slice(0, 12),
    })),
  ]
  : this.toolManifest || DEFAULT_TOOL_MANIFEST;
    return manifest.map(entry => ({ name: entry.name, score: scorePrompt(tokens, entry) }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.name);
  }

  registerTool(tool) {
  if (typeof this.toolRegistry?.registerTool === 'function') this.toolRegistry.registerTool(tool);
  else if (Array.isArray(this.toolManifest)) this.toolManifest.push(tool);
  return this;
  }
  registerSkill(skill) {
  if (typeof this.toolRegistry?.registerSkill === 'function') this.toolRegistry.registerSkill(skill);
  return this;
  }
  async loadSkills() { await this.toolRegistry.loadSkills?.(); return this; }
  registerPlugin(plugin) { this.pluginRegistry.register(plugin); return this; }
  async loadPlugin(plugin) { await this.pluginLoader.load(plugin); return this; }
  async unloadPlugin(id) { return this.pluginLoader.unload(id); }

  async bootstrapSession(prompt, { sessionId = null, permissionMode = null, context = {}, wbs = null } = {}) {
    const config = {
      ...this.defaultConfig,
      permissionMode: permissionMode || this.defaultConfig.permissionMode,
      toolExecutor: async (toolName) => {
        const results = await this.executeTools([{ name: toolName, arguments: {} }], context);
        return results[0]?.result;
      },
    };
    const wbsText = wbs?.length ? `\n\n## Work Breakdown State\n${formatWbsForPrompt(wbs)}` : '';
    const promptWithWbs = `${prompt}${wbsText}`, matchedTools = this.routePrompt(promptWithWbs);
    const session = sessionId ? RuntimeSession.fromSession(sessionId, { prompt: promptWithWbs, matchedTools, permissionDenials: [], config }) : RuntimeSession.create({ prompt: promptWithWbs, matchedTools, permissionDenials: [], config });
    session.permissionDenials = this._inferDenials(matchedTools, session);
    session.loop = new AgentLoop({ maxRetries: Math.max(0, Math.min(2, (config.maxTurns || 8) - 1)) });
    logger.info(`AgentRuntime bootstrap — capabilities: [${matchedTools.join(', ')}] denials: ${session.permissionDenials.length}`);
    this.emit('session:created', session); return session;
  }

  /**
   * Canonical convenience entry point. All public run-style callers converge here.
   */
  async run(input, context = {}) {
    return this.execute({ content: input, context });
  }
  /** Stream a response through the canonical runtime; model ports may provide token events. */
  async *stream(prompt, options = {}) {
    const input = String(prompt ?? '');
    if (this.model && typeof this.model.stream === 'function') {
      const events = this.model.stream({
        messages: options.messages || [{ role: 'user', content: input }],
        tools: options.tools || this.toolManifest || DEFAULT_TOOL_MANIFEST,
        context: options.context || {},
        signal: options.signal || null,
      });
      for await (const event of events) yield event;
      return;
    }

    const result = await this.execute({
      content: input,
      sessionId: options.sessionId,
      context: options.context || {},
    });
    const text = String(result?.response ?? result?.content ?? '');
    yield { type: 'text', text, content: text };
    yield { type: 'done' };
  }

  /**
   * Compatibility contract for older harnesses. This delegates to execute()
   * so it cannot create a second execution loop or runtime owner.
   */
  async executeTurn(frame = {}, context = {}) {
    if (typeof frame === 'string') {
      return this.execute({ content: frame, context });
    }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      throw new TypeError('AgentRuntime.executeTurn requires a prompt or frame object');
    }
    const content = frame.content ?? frame.prompt;
    if (content == null) throw new TypeError('AgentRuntime.executeTurn requires frame.content or frame.prompt');
    return this.execute({
      ...frame,
      content,
      context: { ...context, ...(frame.context || {}) },
    });
  }

  async execute(frame = {}) {
    if (!frame || frame.content == null) throw new TypeError('AgentRuntime.execute requires frame.content');

    // Canonical direct-dispatch path: every caller still crosses this execution
    // boundary, including harness/domain adapters. No adapter owns execution.
    if (Array.isArray(frame.toolCalls) && frame.toolCalls.length) {
      const results = [];
      for (const call of frame.toolCalls) {
        const name = String(call?.name || '').replace(/__/g, '.');
        if (!name) throw new TypeError('AgentRuntime.execute received a tool call without a name');
        let args = call?.arguments ?? {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        results.push({ name, result: await this._executeToolForFrame(name, args, frame.context || frame) });
      }
      return {
        response: results.length === 1 ? results[0].result : results,
        sessionId: frame.sessionId || null,
        iterations: 1,
        toolsUsed: results.map((entry) => entry.name),
        toolCalls: results,
      };
    }

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
    const registryTools = this.toolRegistry?.getToolsForLLM?.();
    const registeredTools = this.toolRegistry?.getAllTools?.() || [];
    const registryDeclarations = registeredTools.map((tool) => {
      const schema = tool.schema || {};
      return {
        name: tool.fullName || tool.name,
        description: schema.description || tool.description || '',
        parameters: normalizeToolParameters(schema.parameters),
      };
    }).filter((tool) => tool.name);
    const registryOwnsToolDiscovery = typeof this.toolRegistry?.getToolsForLLM === 'function'
      || typeof this.toolRegistry?.getAllTools === 'function';
    const tools = Array.isArray(frame.tools)
      ? frame.tools
      : (Array.isArray(registryTools) && registryTools.length)
        ? registryTools
        : registryDeclarations.length
          ? registryDeclarations
          : registryOwnsToolDiscovery
            ? []
            : this.toolManifest || DEFAULT_TOOL_MANIFEST;
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
          const result = await this._executeToolForFrame(name, args, frame);
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
            if (current.tool) return this._executeToolForFrame(current.tool, current.args || {}, current.context || current);
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

  async _executeToolForFrame(toolName, params, frame = {}) {
    const context = { ...frame, ...(frame.context || {}) };
    const tenantId = context.tenantId || context.tenant_id;
    const userId = context.userId || context.user_id || context.uid;
    if (!tenantId || !userId) {
      throw new Error('authenticated tenant context required for tool execution');
    }

    const tool = this.toolRegistry?.getTool?.(toolName);
    const roleMutationRequiresApproval = Boolean(context.agentRole)
      && /(?:^|\.)(create|update|delete|remove|refund|transfer|charge|settle|pay|block|reboot|disable|enable)$/i.test(toolName);
    const requiresApproval = Boolean(tool?.capability?.requiresApproval || roleMutationRequiresApproval);
    const approvalGranted = context.approvalGranted === true || context.approved === true;
    const taskRegistry = getTaskRegistry();
    const task = taskRegistry.create(`Execute tool ${toolName}`, {
      action: toolName,
      owner: { userId, platformId: context.platformId || null },
      context: { ...context, tenantId, userId },
      input: params,
      requiresExecutionApproval: requiresApproval,
    });

    taskRegistry.markPlanReady(task.taskId, {
      action: toolName,
      input: params,
      scopedTo: { tenantId, userId },
    });
    taskRegistry.markDraftReady(task.taskId, {
      action: toolName,
      input: params,
      requiresApproval,
    });

    if (requiresApproval && !approvalGranted) {
      const pending = await this.approvalGate.request({ toolName, params, context: { ...context, tenantId, userId } });
      return { ...pending, approvalRequired: true, agentRole: context.agentRole || null, taskId: task.taskId, phase: 'approve' };
    }

    if (requiresApproval) {
      taskRegistry.approveExecution(task.taskId, context.approvalId || 'runtime-explicit-approval');
    }
    taskRegistry.beginExecution(task.taskId);

    try {
      const result = await this._invokeTool(toolName, params, {
        ...context,
        tenantId,
        userId,
        taskId: task.taskId,
        action: toolName,
        phase: 'execute',
        approvalGranted,
        approved: approvalGranted,
      });
      taskRegistry.setPhase(task.taskId, TaskPhase.OBSERVE);
      taskRegistry.markVerified(task.taskId, [{ type: 'tool-execution', toolName, verified: true }]);
      taskRegistry.setPhase(task.taskId, TaskPhase.COMPLETE);
      taskRegistry.setStatus(task.taskId, TaskStatus.COMPLETED);
      return result;
    } catch (error) {
      taskRegistry.setStatus(task.taskId, TaskStatus.FAILED, error.message);
      throw error;
    }
  }

  /**
   * Execute a batch of model/framework tool calls through the canonical runtime
   * path. This compatibility entry point delegates to the same scoped task
   * lifecycle used by AgentRuntime's model loop.
   */
  async executeTools(toolCalls = [], context = {}) {
    if (!Array.isArray(toolCalls)) throw new TypeError('toolCalls must be an array');
    const results = [];
    for (const call of toolCalls) {
      const toolCallId = call?.id || call?.toolCallId || null;
      const name = String(call?.name || '').replace(/__/g, '.');
      let args = call?.arguments ?? call?.args ?? {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      try {
        const result = await this._executeToolForFrame(name, args, {
          ...context,
          approvalGranted: context.approvalGranted === true || context.approved === true,
          approved: context.approved === true || context.approvalGranted === true,
        });
        results.push({ toolCallId, result });
      } catch (error) {
        results.push({ toolCallId, result: { error: error.message } });
      }
    }
    return results;
  }

  /** Approve and resume a persisted action after host-provided authorization. */
  async approveAction({ actionId, actor, tenantId, authorize } = {}) {
    return this.approvalGate.resume({
      actionId, actor, tenantId, authorize,
      execute: (toolName, params, context) => this._invokeTool(toolName, params, context),
    });
  }

  /** Public compatibility entry point; execution still crosses the canonical task gate. */
  async executeTool(toolName, params = {}, context = {}) {
    return this._executeToolForFrame(toolName, params, context);
  }

  async _invokeTool(toolName, params = {}, context = {}) {
    if (this.injectedToolExecutor) {
      if (!this.toolExecutor) throw new Error('No tool executor configured');
      return this.toolExecutor(toolName, params, context);
    }
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

  listTools() {
  const registeredTools = this.toolRegistry?.getAllTools?.() || [];
  return (registeredTools.length ? registeredTools : (this.toolManifest || DEFAULT_TOOL_MANIFEST)).map(t => t.fullName || t.name);
  }
  findTools(query) {
  const needle = String(query).toLowerCase();
  const registeredTools = this.toolRegistry?.getAllTools?.() || [];
  const manifest = [
  ...(this.toolManifest || DEFAULT_TOOL_MANIFEST),
  ...registeredTools.map(tool => ({
  name: tool.fullName || tool.name,
  keywords: tool.keywords || String(tool.description || '').toLowerCase().split(/\s+/),
  })),
  ];
  return manifest.filter(t => t.name.includes(needle) || (t.keywords || []).some(k => String(k).includes(needle))).map(t => t.name);
  }
}

let _runtime = null;
function getAgentRuntime(config = {}) {
  if (!_runtime) {
    _runtime = new AgentRuntime(config);
  } else {
    // Composition roots may be loaded after the singleton was first requested.
    // Configure the existing owner rather than constructing a competing runtime.
    if (config.toolRegistry) _runtime.setToolRegistry(config.toolRegistry);
    if (config.model) _runtime.setModel(config.model);
  }
  return _runtime;
}
export { AgentRuntime, RuntimeSession, TurnResult, UsageSummary, getAgentRuntime };
export default { AgentRuntime, RuntimeSession, getAgentRuntime, TOOL_MANIFEST };
