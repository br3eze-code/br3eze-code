import EventEmitter from 'node:events';
import { AgentEngine } from './agentEngine.js';
import { PermissionMode, PermissionDenial } from './permissions.js';
import { getTaskRegistry, TaskStatus } from './taskRegistry.js';
import { logger } from './logger.js';
import { formatWbsForPrompt } from './action-wbs.js';
import { buildExecutionContext } from './execution-context.js';
import { SkillDisabledError } from './tool-errors.js';
import { isApprovalRequired } from './agent-role-profiles.js';

/** Canonical domain-neutral AgentOS runtime. */
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
    return ['# Runtime Session', '', `Prompt: ${this.prompt}`, `Session ID: ${this.engine.sessionId}`, '', '## Matched Tools',
      ...(this.matchedTools.length ? this.matchedTools.map(t => `- ${t}`) : ['- none']), '', '## Permission Denials',
      ...(this.permissionDenials.length ? this.permissionDenials.map(d => `- ${d.toolName}: ${d.reason}`) : ['- none']), '', '## Agent State', this.engine.renderSummary(),
      ...(this.taskId ? [`Task ID: ${this.taskId}`] : [])].join('\n');
  }
}

class AgentRuntime extends EventEmitter {
  constructor(config = {}) {
    super();
    this.defaultConfig = { permissionMode: config.permissionMode || PermissionMode.PROMPT, maxTurns: config.maxTurns || 8, maxBudgetTokens: config.maxBudgetTokens || 4000, compactAfterTurns: config.compactAfterTurns || 12 };
    this.toolManifest = Array.isArray(config.toolManifest) ? config.toolManifest : DEFAULT_TOOL_MANIFEST;
    this.toolExecutor = typeof config.toolExecutor === 'function' ? config.toolExecutor : null;
    this.toolRegistry = config.toolRegistry || null; this.sessionManager = config.sessionManager || null; this.memoryStore = config.memoryStore || null; this.safetyEnvelope = config.safetyEnvelope || null;
    this.subagentRuntime = config.subagentRuntime || null;
  }
  routePrompt(prompt = '', limit = 5) {
    const tokens = new Set(prompt.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
    return this.toolManifest.map(entry => ({ name: entry.name, score: scorePrompt(tokens, entry) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.name);
  }
  async bootstrapSession(prompt, { sessionId = null, permissionMode = null, context = {}, wbs = null } = {}) {
    const config = { ...this.defaultConfig, permissionMode: permissionMode || this.defaultConfig.permissionMode, toolExecutor: this.toolExecutor };
    const engine = sessionId ? AgentEngine.fromSession(sessionId, config) : AgentEngine.create(config);
    const promptWithWbs = `${prompt}${wbs?.length ? `\n\n## Work Breakdown State\n${formatWbsForPrompt(wbs)}` : ''}`;
    const matchedTools = this.routePrompt(promptWithWbs); const denials = this._inferDenials(matchedTools, engine);
    const session = new RuntimeSession({ prompt: promptWithWbs, engine, matchedTools, permissionDenials: denials }); this.emit('session:created', session); return session;
  }
  async runTurnLoop(prompt, opts = {}) {
    const session = await this.bootstrapSession(prompt, opts); const { engine, matchedTools, permissionDenials } = session;
    const turns = opts.maxTurns || this.defaultConfig.maxTurns; const results = [];
    const promptWithWbs = opts.wbs?.length ? `${prompt}\n\n## Work Breakdown State\n${formatWbsForPrompt(opts.wbs)}` : prompt;
    for (let i = 0; i < turns; i++) { const result = await engine.submitMessage(i === 0 ? promptWithWbs : `${promptWithWbs} [turn ${i + 1}]`, matchedTools, permissionDenials); results.push(result); this.emit('turn', result); if (result.stopReason !== 'completed') break; }
    return { results, session, sessionPath: engine.persistSession() };
  }
  async executeTools(toolCalls = [], frame = {}) {
    if (!this.toolRegistry) throw new Error('No tool registry configured');
    const ctx = buildExecutionContext({ ...frame, sessionId: this.sessionManager?.getSessionId?.(frame) || frame.sessionId || null, message: frame.message || frame.msg || frame });
    const results = [];
    for (const call of toolCalls) {
      const toolName = (call.name || '').replace(/__/g, '.');
      try {
        const tool = this.toolRegistry.getTool(toolName); if (!tool) { results.push({ toolCallId: call.id, result: { error: `Tool not found: ${toolName}` } }); continue; }
        const validation = this.validateParams(tool.schema?.parameters, call.arguments || {}); if (!validation.valid) { results.push({ toolCallId: call.id, result: { error: validation.error } }); continue; }
        if (ctx.agentRole && isApprovalRequired(ctx.agentRole, toolName) && !ctx.approvalGranted) { results.push({ toolCallId: call.id, result: { error: 'Approval required', approvalRequired: true, agentRole: ctx.agentRole, toolName } }); continue; }
        if (this.safetyEnvelope && !this.safetyEnvelope.checkToolExecution(toolName, call.arguments || {})) { results.push({ toolCallId: call.id, result: { error: 'Blocked by safety envelope' } }); continue; }
        results.push({ toolCallId: call.id, result: await this.toolRegistry.execute(toolName, call.arguments || {}, ctx) });
      } catch (err) {
        logger.error(`Tool execution error (${toolName}):`, err.message);
        const friendly = err instanceof SkillDisabledError ? `Skill is currently disabled: ${err.skillName}` : err.message;
        results.push({ toolCallId: call.id, result: { error: friendly } });
      }
    }
    return results;
  }
  validateParams(schema, params = {}) {
    if (!schema) return { valid: true }; let paramList = [];
    if (Array.isArray(schema)) paramList = schema; else if (schema.properties) { const required = schema.required || []; paramList = Object.entries(schema.properties).map(([name, def]) => ({ name, type: def.type, required: required.includes(name) })); } else return { valid: true };
    for (const param of paramList) { if (param.required && !(param.name in params)) return { valid: false, error: `Missing required parameter: ${param.name}` }; if (param.name in params) { const value = params[param.name]; if (param.type === 'string' && typeof value !== 'string') return { valid: false, error: `Parameter ${param.name} must be a string` }; if (param.type === 'number' && typeof value !== 'number') return { valid: false, error: `Parameter ${param.name} must be a number` }; if (param.type === 'boolean' && typeof value !== 'boolean') return { valid: false, error: `Parameter ${param.name} must be a boolean` }; } }
    return { valid: true };
  }
  async dispatchTask(prompt, opts = {}) {
    const registry = getTaskRegistry(); const task = registry.create(prompt, { description: opts.description, action: opts.action || 'assist.task', owner: { userId: opts.context?.userId || null, platformId: opts.context?.platformId || null }, context: opts.context || {}, wbs: opts.wbs || null });
    registry.setStatus(task.taskId, TaskStatus.RUNNING); this.emit('task:dispatched', task); this._executeTask(task.taskId, prompt, opts).catch(err => { registry.setStatus(task.taskId, TaskStatus.FAILED, err.message); logger.error(`Task ${task.taskId} failed:`, err.message); }); return task;
  }
  async _executeTask(taskId, prompt, opts) { const registry = getTaskRegistry(); const { results } = await this.runTurnLoop(prompt, { ...opts, wbs: opts.wbs || registry.get(taskId)?.wbs, context: opts.context || registry.get(taskId)?.scope || {} }); for (const r of results) registry.appendOutput(taskId, 'assistant', r.output); const last = results[results.length - 1]; registry.setStatus(taskId, last?.stopReason === 'completed' ? TaskStatus.COMPLETED : TaskStatus.FAILED); }

  /** Spawn through the runtime so child scope/permissions can never widen its parent. */
  spawnSubagent({ parentId = null, role, scope = {}, permissions = [], ...options } = {}) {
    if (!this.subagentRuntime) throw new Error('No subagent runtime configured');
    if (!parentId) return this.subagentRuntime.spawn({ role, scope, permissions, ...options });
    const parent = this.subagentRuntime.get(parentId);
    if (!parent) throw new Error(`Parent subagent not found: ${parentId}`);
    const allowed = new Set(parent.permissions || []);
    const requested = permissions.length ? permissions : [...allowed];
    const narrowedPermissions = requested.filter(permission => allowed.has(permission));
    const childScope = { ...scope };
    for (const key of ['tenantId', 'workspaceId', 'principalId']) {
      if (parent.scope?.[key] != null) childScope[key] = parent.scope[key];
    }
    return this.subagentRuntime.spawn({ parentId, role, scope: childScope, permissions: narrowedPermissions, ...options });
  }

  runSubagent(id, input, options = {}) {
    if (!this.subagentRuntime) throw new Error('No subagent runtime configured');
    return this.subagentRuntime.run(id, input, options);
  }

  handoffSubagent(id, target, payload = {}) {
    if (!this.subagentRuntime) throw new Error('No subagent runtime configured');
    const result = this.subagentRuntime.handoff(id, target, payload);
    this.emit('subagent:handoff', { id, target, payload });
    return result;
  }

  terminateSubagent(id, reason) {
    if (!this.subagentRuntime) throw new Error('No subagent runtime configured');
    const result = this.subagentRuntime.terminate(id, reason);
    this.emit('subagent:terminated', { id, reason });
    return result;
  }

  _inferDenials(toolNames, engine) { return toolNames.flatMap(name => { const check = engine.enforcer.check(name); return check.allowed ? [] : [new PermissionDenial(name, check.reason)]; }); }
  listTools() { return this.toolManifest.map(t => t.name); }
  findTools(query = '') { const needle = query.toLowerCase(); return this.toolManifest.filter(t => t.name.includes(needle) || t.keywords.some(k => k.includes(needle))).map(t => t.name); }
}

let _runtime = null;
function getAgentRuntime(config = {}) { if (!_runtime) _runtime = new AgentRuntime(config); return _runtime; }
function resetAgentRuntime() { _runtime = null; }
export { AgentRuntime, RuntimeSession, getAgentRuntime, resetAgentRuntime };
export default { AgentRuntime, RuntimeSession, getAgentRuntime, resetAgentRuntime, TOOL_MANIFEST };
