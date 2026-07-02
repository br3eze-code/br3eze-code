/**
 * Core Agent - Central nervous system of the WiFi Billing Agent OS
 * Manages agent lifecycle, event bus, and state coordination
 * @version 4.0.0
 */

const EventBus = require('./EventBus.js');
const StateManager = require('./StateManager.js');

class LifecycleController {
  constructor(core) {
    this.core = core;
  }
  start() {
    console.log('[LifecycleController] Started');
  }
  stop() {
    console.log('[LifecycleController] Stopped');
  }
  registerTask(name, cb) {
    console.log(`[LifecycleController] Task registered: ${name}`);
  }
  initiateFailover() {}
  restartAgent() {}
}

class CoreAgent {
  constructor(config = {}) {
    this.config = {
      agentId: config.agentId || this.generateAgentId(),
      nodeType: config.nodeType || 'mobile', // mobile, hotspot, relay, server
      heartbeatInterval: config.heartbeatInterval || 30000,
      maxRetries: config.maxRetries || 3,
      ...config,
    };

    this.state = 'initialized';
    this.agents = new Map();
    this.eventBus = new EventBus();
    this.stateManager = new StateManager();
    this.lifecycleController = new LifecycleController(this);

    this.metrics = {
      startTime: Date.now(),
      messagesProcessed: 0,
      errors: 0,
      lastHeartbeat: null,
    };
  }

  async initialize() {
    console.log(`[CoreAgent] Initializing ${this.config.agentId}...`);

    // Initialize state management
    await this.stateManager.initialize({
      persistence: true,
      encryption: true,
      sync: true,
    });

    // Setup event routing
    this.setupEventRouting();

    // Register core tasks
    this.registerCoreTasks();

    // Start lifecycle
    await this.lifecycleController.start();

    this.state = 'active';
    this.emit('core:initialized', { agentId: this.config.agentId });

    return this;
  }

  registerAgent(agentType, agentInstance) {
    if (this.agents.has(agentType)) {
      throw new Error(`Agent type ${agentType} already registered`);
    }

    agentInstance.core = this;
    agentInstance.eventBus = this.eventBus;
    agentInstance.stateManager = this.stateManager;

    this.agents.set(agentType, agentInstance);

    // Setup agent event forwarding
    agentInstance.on('*', (event, data) => {
      this.eventBus.emit(`agent:${agentType}:${event}`, data);
    });

    console.log(`[CoreAgent] Registered ${agentType}`);
    this.emit('core:agent:registered', { type: agentType, id: agentInstance.id });
  }

  async startAgent(agentType) {
    const agent = this.agents.get(agentType);
    if (!agent) throw new Error(`Agent ${agentType} not found`);

    await agent.initialize();
    await agent.activate();

    this.emit('core:agent:started', { type: agentType });
  }

  async dispatchTask(taskName, payload, options = {}) {
    const task = this.findTask(taskName);
    if (!task) throw new Error(`Task ${taskName} not found`);

    const context = {
      core: this,
      agents: this.agents,
      state: this.stateManager,
      ...options.context,
    };

    try {
      const result = await task.execute(payload, context);
      this.metrics.messagesProcessed++;
      return result;
    } catch (error) {
      this.metrics.errors++;
      throw error;
    }
  }

  setupEventRouting() {
    // System-level event routing
    this.eventBus.on('system:critical', data => {
      this.handleCriticalEvent(data);
    });

    this.eventBus.on('agent:failure', data => {
      this.handleAgentFailure(data);
    });

    // Inter-agent communication
    this.eventBus.on('gossip:receive', message => {
      this.routeGossipMessage(message);
    });
  }

  registerCoreTasks() {
    // Mock missing task files to prevent require() crash
    this.lifecycleController.registerTask('heartbeat', () => {
      /* Heartbeat task */
    });
    this.lifecycleController.registerTask('health_check', () => {
      /* Health task */
    });
  }

  async handleCriticalEvent(data) {
    console.error('[CoreAgent] Critical event:', data);

    // Notify all agents
    this.agents.forEach(agent => {
      agent.handleCritical(data);
    });

    // Trigger failover if needed
    if (data.requiresFailover) {
      await this.lifecycleController.initiateFailover();
    }
  }

  async handleAgentFailure({ agentType, error }) {
    console.error(`[CoreAgent] Agent ${agentType} failed:`, error);

    const agent = this.agents.get(agentType);
    if (agent && agent.config.autoRestart !== false) {
      await this.lifecycleController.restartAgent(agentType);
    }
  }

  routeGossipMessage(message) {
    // Route gossip messages to appropriate agents
    switch (message.type) {
      case 'billing_sync':
        this.agents.get('billing')?.handleGossip(message);
        break;
      case 'auth_broadcast':
        this.agents.get('auth')?.handleGossip(message);
        break;
      case 'presence':
        // Update peer registry
        break;
    }
  }

  generateAgentId() {
    return `pc-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  emit(event, data) {
    this.eventBus.emit(event, {
      ...data,
      timestamp: Date.now(),
      source: 'core',
    });
  }

  on(event, handler) {
    return this.eventBus.on(event, handler);
  }

  async shutdown() {
    this.state = 'shutting_down';

    // Shutdown all agents in reverse order
    const agentTypes = Array.from(this.agents.keys()).reverse();
    for (const type of agentTypes) {
      await this.agents.get(type).deactivate();
    }

    await this.lifecycleController.stop();
    await this.stateManager.close();

    this.state = 'terminated';
    this.emit('core:shutdown', { metrics: this.metrics });
  }

  getStatus() {
    return {
      agentId: this.config.agentId,
      state: this.state,
      uptime: Date.now() - this.metrics.startTime,
      agents: Array.from(this.agents.keys()),
      metrics: this.metrics,
    };
  }
}

module.exports = CoreAgent;
