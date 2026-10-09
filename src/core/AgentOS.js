import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import AgentRuntime from './agentRuntime.js';
import { ToolRegistry } from './ToolRegistry.js';
import ChannelManager from './channels/ChannelManager.js';
import MemoryManager from './memory/MemoryManager.js';
import LLMCoordinator from './llm/LLMCoordinator.js';
import WorkflowEngine from './WorkflowEngine.js';
import TelemetryCollector from './TelemetryCollector.js';
import HealthMonitor from './HealthMonitor.js';
import CircuitBreaker from '../utils/CircuitBreaker.js';
import { logger } from './logger.js';
import ContextEngine from './context/ContextEngine.js';

/**
 * AgentOS application kernel.
 * Core is vendor/domain neutral. External capabilities are injected as adapters.
 */
class AgentOS extends EventEmitter {
  constructor(config = {}) {
    super();
    this.id = config.id || crypto.randomUUID();
    this.config = { ...config };
    this.runtime = config.runtime || new AgentRuntime({
      toolRegistry: config.toolRegistry || new ToolRegistry({
        skillsPath: config.skillsPath || './skills',
        permissionPolicy: config.permissionPolicy,
      }),
      providerManager: config.providerManager || null,
      model: config.model || null,
      permissionMode: config.permissionMode,
    });
    // Compatibility aliases are stores, not execution owners.
    this.skills = this.runtime.toolRegistry;
    this.toolbox = this.runtime.toolRegistry;
    this.channels = new ChannelManager(this);
    this.memory = new MemoryManager(this.config.memoryAdapter || 'memory', { sessionEventStore: this.config.sessionEventStore });
    this.contextEngine = new ContextEngine();
    this.llm = new LLMCoordinator(this.config.llmProvider || config.llm?.primary || 'ollama');
    this.workflows = new WorkflowEngine(this);
    this.telemetry = new TelemetryCollector();
    this.health = new HealthMonitor(this);
    this.adapters = new Map(Object.entries(config.adapters || {}));
    this.services = new Map(Object.entries(config.services || {}));
    this.persistence = config.persistence || null;
    this.breakers = { llm: new CircuitBreaker(5, 60000), persistence: new CircuitBreaker(3, 30000) };
    this.initialized = false;
    this.shutdownHandlers = [];
    this._alertState = new Map();
    this._signalHandlers = {};
  }

  log(message, meta) { logger.info(message, meta); }
  info(message, meta) { logger.info(message, meta); }
  warn(message, meta) { logger.warn(message, meta); }
  error(message, meta) { logger.error(message, meta); }
  getAdapter(id) { return this.adapters.get(id) || null; }
  getService(id) { return this.services.get(id) || null; }

  async initialize() {
    if (this.initialized) return;
    try {
      if (this.persistence?.initialize) await this.persistence.initialize();
      await this.memory.initialize();
      await this.runtime.loadSkills();
      await this.llm.initialize();
      await this.channels.initialize();
      this.health.start();
      this.setupShutdownHandlers();
      this.initialized = true;
      this.emit('initialized');
      logger.info(`AgentOS ${this.id} initialized with ${this.skills.count()} skills`);
    } catch (error) {
      logger.error(`AgentOS initialization failed: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }

  async processInteraction(input, context = {}) {
    const startTime = Date.now();
    const interactionId = crypto.randomUUID();
    try {
      if (!input || (!input.text && !input.action)) throw new Error('Invalid input: requires text or action');
      const execContext = await this.buildContext(input, context, interactionId);
      let result;
      if (input.action) {
        result = await this.runtime.executeTool(input.action, input.params || {}, execContext);
      } else {
        result = await this.runtime.execute({
          content: input.text,
          context: execContext,
          sessionId: input.sessionId || null,
        });
      }
      await this.memory.storeInteraction(interactionId, { input, context: execContext, result, duration: Date.now() - startTime });
      this.telemetry.record('interaction', { id: interactionId, skill: result.skill, duration: Date.now() - startTime, success: true });
      return { id: interactionId, success: true, result: result.output, metadata: { skill: result.skill, duration: Date.now() - startTime, context: execContext.summary } };
    } catch (error) {
      this.telemetry.record('interaction_error', { id: interactionId, error: error.message, duration: Date.now() - startTime });
      return { id: interactionId, success: false, error: error.message, help: await this.suggestHelp(input || {}, error) };
    }
  }

  async classifyIntent(text, context = {}) {
    const matches = this.runtime.routePrompt(text, 1);
    if (!matches.length) throw new Error('No capability matched the request');
    return { skill: matches[0], params: {}, confidence: 1, context };
  }

  async executeSkill(skillName, params = {}, context = {}) {
    const output = await this.runtime.executeTool(skillName, params, context);
    return { skill: String(skillName).split('.')[0], tool: String(skillName).includes('.') ? String(skillName).split('.').slice(1).join('.') : null, output, params, context: context.summary || {} };
  }

  async buildContext(input, context, interactionId) {
    const userMemory = await this.memory.getUserContext(input.userId);
    const session = await this.memory.getSession(input.sessionId);
    const scoped = this.contextEngine.build({ ...context, ...input, source: 'agentos' });
    return { ...scoped, id: interactionId, agentId: this.id, userId: scoped.userId || input.userId, sessionId: input.sessionId, timestamp: new Date().toISOString(), memory: userMemory, session, summary: { userId: scoped.userId || input.userId, tenantId: scoped.tenantId, siteId: scoped.siteId, nodeId: scoped.nodeId, channel: scoped.channel, previousIntent: userMemory?.lastIntent, skillHistory: userMemory?.recentSkills || [] }, skills: this.skills, llm: this.llm, channels: this.channels };
  }

  async checkPermissions(userId, requiredPermissions) {
    const userPerms = await this.memory.getPermissions(userId);
    const missing = requiredPermissions.filter(p => !userPerms.includes(p));
    if (missing.length) throw new Error(`Missing permissions: ${missing.join(', ')}`);
  }

  async suggestHelp(input, error) {
    try { return await this.llm.generate(`Input: "${input.text || input.action || ''}"\nError: ${error.message}\nAvailable capabilities: ${this.skills.getDescriptions().map(s => s.name).join(', ')}\nSuggest a concise next step.`, { maxTokens: 150 }); }
    catch { return 'Try using help to see available capabilities.'; }
  }

  async executeWorkflow(workflowId, params, context) { return this.workflows.execute(workflowId, params, context); }
  async executeTool(toolName, params, context) { return this.runtime.executeTool(toolName, params, context); }
  async sendMessage(channel, userId, message) { return this.channels.send(channel, userId, message); }
  async broadcast(message, filter = null) { return this.channels.broadcast(message, filter); }
  async sendToAll(message) { return this.broadcast(message); }

  async alertOnce(key, message) {
    const last = this._alertState.get(key);
    if (!last || Date.now() - last > 2 * 60 * 60 * 1000) { this._alertState.set(key, Date.now()); return this.broadcast(message); }
    return { success: true, skipped: true };
  }

  setupShutdownHandlers() {
    const shutdown = async () => {
      for (const handler of this.shutdownHandlers) await handler();
      await this.channels.closeAll();
      await this.memory.close();
      await this.health.stop();
      if (this.persistence?.close) await this.persistence.close();
    };
    this._signalHandlers.SIGTERM = () => shutdown();
    this._signalHandlers.SIGINT = () => shutdown();
    process.on('SIGTERM', this._signalHandlers.SIGTERM);
    process.on('SIGINT', this._signalHandlers.SIGINT);
  }

  onShutdown(handler) { this.shutdownHandlers.push(handler); }
  getStatus() { return { id: this.id, initialized: this.initialized, executionOwner: 'AgentRuntime', skills: this.skills.count(), adapters: [...this.adapters.keys()], services: [...this.services.keys()], channels: this.channels.getStatus(), memory: this.memory.getStatus(), health: this.health.getStatus(), uptime: process.uptime() }; }

  async destroy() {
    if (!this.initialized) return;
    if (this._signalHandlers.SIGTERM) process.off('SIGTERM', this._signalHandlers.SIGTERM);
    if (this._signalHandlers.SIGINT) process.off('SIGINT', this._signalHandlers.SIGINT);
    await this.channels.closeAll();
    await this.memory.close();
    await this.health.stop();
    if (this.persistence?.close) await this.persistence.close();
    this.initialized = false;
  }
}

export default AgentOS;
export { AgentOS };
