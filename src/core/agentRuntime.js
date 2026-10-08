import EventEmitter from 'node:events';
import { AgentEngine } from './agentEngine.js';
import { PermissionMode, PermissionDenial } from './permissions.js';
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

class RuntimeSession {
  constructor({ prompt, engine, matchedTools, permissionDenials, taskId = null, loop = null }) { this.prompt = prompt; this.engine = engine; this.matchedTools = matchedTools; this.permissionDenials = permissionDenials; this.taskId = taskId; this.loop = loop; this.createdAt = new Date().toISOString(); }
  asMarkdown() { return ['# Runtime Session', '', `Prompt: ${this.prompt}`, `Session ID: ${this.engine.sessionId}`, '', '## Matched Tools', ...(this.matchedTools.length ? this.matchedTools.map(t => `- ${t}`) : ['- none']), '', '## Permission Denials', ...(this.permissionDenials.length ? this.permissionDenials.map(d => `- ${d.toolName}: ${d.reason}`) : ['- none']), '', '## Agent State', this.engine.renderSummary(), ...(this.taskId ? [`Task ID: ${this.taskId}`] : [])].join('\n'); }
}

class AgentRuntime extends EventEmitter {
  constructor(config = {}) {
    super();
    this.defaultConfig = { permissionMode: config.permissionMode || PermissionMode.PROMPT, maxTurns: config.maxTurns || 8, maxBudgetTokens: config.maxBudgetTokens || 4000, compactAfterTurns: config.compactAfterTurns || 12 };
    this.toolManifest = Array.isArray(config.toolManifest) ? config.toolManifest : DEFAULT_TOOL_MANIFEST;
    this.toolExecutor = typeof config.toolExecutor === 'function' ? config.toolExecutor : null;
    this.verificationEngine = config.verificationEngine || new VerificationEngine(config.verificationChecks || {});
    this.model = config.model || null;
    if (this.model) validateModelPort(this.model);
  }

  routePrompt(prompt, limit = 5) {
    const tokens = new Set(prompt.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
    return this.toolManifest.map(entry => ({ name: entry.name, score: scorePrompt(tokens, entry) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.name);
  }

  async bootstrapSession(prompt, { sessionId = null, permissionMode = null, context = {}, wbs = null } = {}) {
    const config = { ...this.defaultConfig, permissionMode: permissionMode || this.defaultConfig.permissionMode, toolExecutor: this.toolExecutor };
    const engine = sessionId ? AgentEngine.fromSession(sessionId, config) : AgentEngine.create(config);
    const wbsText = wbs?.length ? `\n\n## Work Breakdown State\n${formatWbsForPrompt(wbs)}` : '';
    const promptWithWbs = `${prompt}${wbsText}`;
    const matchedTools = this.routePrompt(promptWithWbs);
    const denials = this._inferDenials(matchedTools, engine);
    const loop = new AgentLoop({ maxRetries: Math.max(0, Math.min(2, (config.maxTurns || 8) - 1)) });
    logger.info(`AgentRuntime bootstrap — capabilities: [${matchedTools.join(', ')}] denials: ${denials.length}`);
    const session = new RuntimeSession({ prompt: promptWithWbs, engine, matchedTools, permissionDenials: denials, loop });
    this.emit('session:created', session);
    return session;
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
    const sessionId = frame.sessionId || null;
    const messages = Array.isArray(frame.messages) ? [...frame.messages] : [{ role: 'user', content: String(frame.content) }];
    const tools = Array.isArray(frame.tools) ? frame.tools : this.toolManifest;
    const response = await this.model.execute(createModelRequest({ messages, tools, context: frame.context || frame, signal: frame.signal || null }));
    return {
      response: response?.content ?? response?.text ?? '',
      sessionId,
      iterations: 1,
      toolsUsed: Array.isArray(response?.toolCalls) ? response.toolCalls.map(call => call.name).filter(Boolean) : [],
      toolCalls: response?.toolCalls || [],
      raw: response,
    };
  }

  async runTurnLoop(prompt, opts = {}) {
    const session = await this.bootstrapSession(prompt, opts);
    const { engine, matchedTools, permissionDenials } = session;
    const turns = opts.maxTurns || this.defaultConfig.maxTurns;
    const results = [];
    const promptWithWbs = opts.wbs?.length ? `${prompt}\n\n## Work Breakdown State\n${formatWbsForPrompt(opts.wbs)}` : prompt;
    for (let i = 0; i < turns; i++) {
      if (i === 0) {
        session.loop.transition(TURN_STATES.UNDERSTANDING, { turn: i + 1 });
        session.loop.transition(TURN_STATES.PLANNING, { matchedTools });
      }
      session.loop.transition(TURN_STATES.EXECUTING, { turn: i + 1 });
      const result = await engine.submitMessage(i === 0 ? promptWithWbs : `${promptWithWbs} [turn ${i + 1}]`, matchedTools, permissionDenials);
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
    const sessionPath = engine.persistSession();
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
  listTools() { return this.toolManifest.map(t => t.name); }
  findTools(query) { const needle = query.toLowerCase(); return this.toolManifest.filter(t => t.name.includes(needle) || t.keywords.some(k => k.includes(needle))).map(t => t.name); }
}

let _runtime = null;
function getAgentRuntime(config = {}) { if (!_runtime) _runtime = new AgentRuntime(config); return _runtime; }
export { AgentRuntime, RuntimeSession, getAgentRuntime };
export default { AgentRuntime, RuntimeSession, getAgentRuntime, TOOL_MANIFEST };
