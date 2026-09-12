import EventEmitter from 'node:events';
import { AgentEngine } from './agentEngine.js';
import { PermissionMode, PermissionDenial } from './permissions.js';
import { getTaskRegistry, TaskStatus } from './taskRegistry.js';
import { logger } from './logger.js';
import { formatWbsForPrompt } from './action-wbs.js';
import { GuardrailPipeline } from './agent-runtime/Guardrails.js';
import { TraceCollector } from './agent-runtime/Tracing.js';
import { validateStructuredOutput } from './agent-runtime/StructuredOutput.js';

function normalizeManifest(manifest = []) { return manifest.filter(Boolean).map(entry => typeof entry === 'string' ? { name: entry, keywords: [] } : ({ ...entry, keywords: entry.keywords || [] })); }
function scorePrompt(tokens, toolEntry) { return toolEntry.keywords.filter(kw => tokens.has(String(kw).toLowerCase())).length; }

class RuntimeSession {
  constructor({ prompt, engine, matchedTools, permissionDenials, taskId = null, scope = null }) { this.prompt = prompt; this.engine = engine; this.matchedTools = matchedTools; this.permissionDenials = permissionDenials; this.taskId = taskId; this.scope = scope; this.createdAt = new Date().toISOString(); }
  asMarkdown() { return ['# Runtime Session', '', `Prompt: ${this.prompt}`, `Session ID: ${this.engine.sessionId}`, '', '## Matched Tools', ...(this.matchedTools.length ? this.matchedTools.map(t => `- ${t}`) : ['- none']), '', '## Permission Denials', ...(this.permissionDenials.length ? this.permissionDenials.map(d => `- ${d.toolName}: ${d.reason}`) : ['- none']), '', '## Agent State', this.engine.renderSummary(), ...(this.taskId ? ['', `Task ID: ${this.taskId}`] : [])].join('\n'); }
}

class AgentRuntime extends EventEmitter {
  constructor(config = {}) { super(); this.defaultConfig = { permissionMode: config.permissionMode || PermissionMode.PROMPT, maxTurns: config.maxTurns || 8, maxBudgetTokens: config.maxBudgetTokens || 4000, compactAfterTurns: config.compactAfterTurns || 12 }; this.toolManifest = normalizeManifest(config.toolManifest || config.tools || []); this.guardrails = config.guardrails || new GuardrailPipeline(); this.tracer = config.tracer || new TraceCollector({ sink: config.traceSink || null }); this.outputSchema = config.outputSchema || null; }
  setToolManifest(manifest = []) { this.toolManifest = normalizeManifest(manifest); return this; }
  routePrompt(prompt, limit = 5) { const tokens = new Set(String(prompt).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)); return this.toolManifest.map(entry => ({ name: entry.name, score: scorePrompt(tokens, entry) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.name); }
  async bootstrapSession(prompt, { sessionId = null, permissionMode = null, context = {}, wbs = null } = {}) { if (!context.tenantId || !context.userId) throw new Error('tenantId and userId are required in runtime context'); await this.guardrails.input(prompt, context); const engine = sessionId ? AgentEngine.fromSession(sessionId) : AgentEngine.create({ ...this.defaultConfig, permissionMode: permissionMode || this.defaultConfig.permissionMode }); const wbsText = wbs?.length ? `\n\n## Work Breakdown State\n${formatWbsForPrompt(wbs)}` : ''; const promptWithWbs = `${prompt}${wbsText}`; const matchedTools = this.routePrompt(promptWithWbs); const denials = this._inferDenials(matchedTools, engine); const session = new RuntimeSession({ prompt: promptWithWbs, engine, matchedTools, permissionDenials: denials, scope: { tenantId: context.tenantId, userId: context.userId, siteId: context.siteId || null } }); this.emit('session:created', session); return session; }
  async runTurnLoop(prompt, opts = {}) { const session = await this.bootstrapSession(prompt, opts); const { engine, matchedTools, permissionDenials } = session; const turns = opts.maxTurns || this.defaultConfig.maxTurns; const results = []; const rootSpan = this.tracer.start('agent.turns', { tenantId: opts.context.tenantId, taskId: session.taskId }); try { for (let i = 0; i < turns; i++) { const span = this.tracer.start('agent.turn', { turn: i + 1 }, rootSpan); try { const promptWithWbs = opts.wbs?.length ? `${prompt}\n\n## Work Breakdown State\n${formatWbsForPrompt(opts.wbs)}` : prompt; const result = await engine.submitMessage(i === 0 ? promptWithWbs : `${promptWithWbs} [turn ${i + 1}]`, matchedTools, permissionDenials); await this.guardrails.output(result?.output, opts.context || {}); if (this.outputSchema) validateStructuredOutput(result.output, this.outputSchema); results.push(result); this.emit('turn', result); this.tracer.end(span, 'ok', { stopReason: result.stopReason }); if (result.stopReason !== 'completed') break; } catch (error) { this.tracer.end(span, 'error', { error: error.message }); throw error; } } } finally { this.tracer.end(rootSpan, 'ok', { turns: results.length }); } const sessionPath = engine.persistSession(); return { results, session, sessionPath }; }
  async dispatchTask(prompt, opts = {}) { const context = opts.context || {}; if (!context.tenantId || !context.userId) throw new Error('tenantId and userId are required to dispatch a task'); const registry = getTaskRegistry(); const task = registry.create(prompt, { description: opts.description, action: opts.action || 'assist.task', owner: { userId: context.userId, platformId: context.platformId || null }, context, wbs: opts.wbs || null }); this.emit('task:dispatched', task); this._executeTask(task.taskId, prompt, opts).catch(err => { registry.setStatus(task.taskId, TaskStatus.FAILED, err.message); logger.error(`Task ${task.taskId} failed:`, err.message); }); return task; }
  async _executeTask(taskId, prompt, opts) { const registry = getTaskRegistry(); const task = registry.get(taskId); const { results } = await this.runTurnLoop(prompt, { ...opts, wbs: opts.wbs || task?.wbs, context: opts.context || task?.scope || {} }); for (const result of results) registry.appendOutput(taskId, 'assistant', result.output); const last = results.at(-1); registry.setStatus(taskId, last?.stopReason === 'completed' ? TaskStatus.COMPLETED : TaskStatus.FAILED); }
  _inferDenials(toolNames, engine) { return toolNames.flatMap(name => { const check = engine.enforcer.check(name); return check.allowed ? [] : [new PermissionDenial(name, check.reason)]; }); }
  listTools() { return this.toolManifest.map(t => t.name); }
  findTools(query) { const needle = String(query).toLowerCase(); return this.toolManifest.filter(t => t.name.includes(needle) || t.keywords.some(k => String(k).toLowerCase().includes(needle))).map(t => t.name); }
}

let _runtime = null;
function getAgentRuntime(config = {}) { if (!_runtime) _runtime = new AgentRuntime(config); return _runtime; }
export { AgentRuntime, RuntimeSession, getAgentRuntime };
export default { AgentRuntime, RuntimeSession, getAgentRuntime };
