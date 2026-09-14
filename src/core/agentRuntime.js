import EventEmitter from 'node:events';
import { AgentEngine } from './agentEngine.js';
import { PermissionMode, PermissionDenial } from './permissions.js';
import { getTaskRegistry, TaskStatus } from './taskRegistry.js';
import { logger } from './logger.js';
import { formatWbsForPrompt } from './action-wbs.js';

/** Domain-neutral execution runtime. Tool discovery is supplied by the caller. */
const DEFAULT_TOOL_MANIFEST = [
  { name: 'agent.run', keywords: ['agent', 'run', 'execute'] },
  { name: 'workflow.run', keywords: ['workflow', 'flow', 'process'] },
  { name: 'tool.execute', keywords: ['tool', 'execute', 'action'] },
  { name: 'task.status', keywords: ['task', 'status', 'progress'] },
  { name: 'system.status', keywords: ['status', 'health', 'state'] }
];
export const TOOL_MANIFEST = DEFAULT_TOOL_MANIFEST;

function scorePrompt(tokens, entry) { return entry.keywords.filter(k => tokens.has(k)).length; }

class RuntimeSession {
  constructor({ prompt, engine, matchedTools, permissionDenials, taskId = null }) {
    this.prompt = prompt; this.engine = engine; this.matchedTools = matchedTools;
    this.permissionDenials = permissionDenials; this.taskId = taskId; this.createdAt = new Date().toISOString();
  }
  asMarkdown() {
    return ['# Runtime Session', '', `Prompt: ${this.prompt}`, `Session ID: ${this.engine.sessionId}`, '', '## Matched Tools', ...(this.matchedTools.length ? this.matchedTools.map(t => `- ${t}`) : ['- none']), '', '## Permission Denials', ...(this.permissionDenials.length ? this.permissionDenials.map(d => `- ${d.toolName}: ${d.reason}`) : ['- none']), '', '## Agent State', this.engine.renderSummary(), ...(this.taskId ? [`Task ID: ${this.taskId}`] : [])].join('\n');
  }
}

class AgentRuntime extends EventEmitter {
  constructor(config = {}) {
    super();
    this.defaultConfig = { permissionMode: config.permissionMode || PermissionMode.PROMPT, maxTurns: config.maxTurns || 8, maxBudgetTokens: config.maxBudgetTokens || 4000, compactAfterTurns: config.compactAfterTurns || 12 };
    this.toolManifest = Array.isArray(config.toolManifest) ? config.toolManifest : DEFAULT_TOOL_MANIFEST;
  }

  routePrompt(prompt, limit = 5) {
    const tokens = new Set(prompt.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
    return this.toolManifest.map(entry => ({ name: entry.name, score: scorePrompt(tokens, entry) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.name);
  }

  async bootstrapSession(prompt, { sessionId = null, permissionMode = null, context = {}, wbs = null } = {}) {
    const engine = sessionId ? AgentEngine.fromSession(sessionId) : AgentEngine.create({ ...this.defaultConfig, permissionMode: permissionMode || this.defaultConfig.permissionMode });
    const wbsText = wbs?.length ? `\n\n## Work Breakdown State\n${formatWbsForPrompt(wbs)}` : '';
    const promptWithWbs = `${prompt}${wbsText}`;
    const matchedTools = this.routePrompt(promptWithWbs);
    const denials = this._inferDenials(matchedTools, engine);
    logger.info(`AgentRuntime bootstrap — capabilities: [${matchedTools.join(', ')}] denials: ${denials.length}`);
    const session = new RuntimeSession({ prompt: promptWithWbs, engine, matchedTools, permissionDenials: denials });
    this.emit('session:created', session);
    return session;
  }

  async runTurnLoop(prompt, opts = {}) {
    const session = await this.bootstrapSession(prompt, opts);
    const { engine, matchedTools, permissionDenials } = session;
    const turns = opts.maxTurns || this.defaultConfig.maxTurns;
    const results = [];
    const promptWithWbs = opts.wbs?.length ? `${prompt}\n\n## Work Breakdown State\n${formatWbsForPrompt(opts.wbs)}` : prompt;
    for (let i = 0; i < turns; i++) {
      const result = await engine.submitMessage(i === 0 ? promptWithWbs : `${promptWithWbs} [turn ${i + 1}]`, matchedTools, permissionDenials);
      results.push(result); this.emit('turn', result);
      if (result.stopReason !== 'completed') break;
    }
    const sessionPath = engine.persistSession();
    return { results, session, sessionPath };
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
