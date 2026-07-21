/**
 * AI Orchestrator - Autonomous decision making and action planning
 */

import IntentParser from './IntentParser.js';
import ActionPlanner from './ActionPlanner.js';
import AutonomyEngine from './AutonomyEngine.js';

class AIOrchestrator {
  constructor(config = {}) {
    this.config = {
      autonomyLevel: config.autonomyLevel || 'assisted', // 'none', 'assisted', 'semi', 'full'
      learningEnabled: config.learningEnabled !== false,
      maxConcurrentActions: config.maxConcurrentActions || 3,
      safetyThreshold: config.safetyThreshold || 0.8,
      ...config,
    };

    this.intentParser = new IntentParser();
    this.actionPlanner = new ActionPlanner();
    this.autonomyEngine = new AutonomyEngine(this.config);

    this.activePlans = new Map();
    this.learningModel = null;
  }

  async initialize() {
    await this.intentParser.initialize();
    await this.actionPlanner.initialize();
    await this.autonomyEngine.initialize();

    if (this.config.learningEnabled) {
      await this.initializeLearning();
    }

    // Subscribe to system events
    this.setupEventSubscriptions();
  }

  setupEventSubscriptions() {
    // Listen for situations requiring AI intervention
    this.core?.on('wifi:signal_weak', data => {
      this.assessSituation('poor_signal', data);
    });

    this.core?.on('billing:time_low', data => {
      this.assessSituation('session_expiring', data);
    });

    this.core?.on('gossip:peer_lost', data => {
      this.assessSituation('network_partition', data);
    });
  }

  async processUserIntent(input, context = {}) {
    // Parse natural language or structured intent
    const intent = await this.intentParser.parse(input, {
      userId: context.userId,
      currentSession: context.session,
      availableActions: this.getAvailableActions(),
    });

    // Determine required autonomy level
    const requiredAutonomy = this.determineAutonomyLevel(intent);

    if (requiredAutonomy > this.getAutonomyValue(this.config.autonomyLevel)) {
      // Request user confirmation
      const confirmed = await this.requestUserConfirmation(intent);
      if (!confirmed) return { status: 'cancelled' };
    }

    // Generate action plan
    const plan = await this.actionPlanner.createPlan(intent, {
      constraints: context.constraints,
      priorities: context.priorities,
      safetyThreshold: this.config.safetyThreshold,
    });

    // Execute or queue plan
    if (this.canExecuteImmediately(plan)) {
      return await this.executePlan(plan);
    } else {
      return await this.queuePlan(plan);
    }
  }

  async assessSituation(situationType, data) {
    // Autonomous situation assessment
    const assessment = await this.autonomyEngine.assess({
      type: situationType,
      data,
      currentState: this.core?.getStatus(),
      activePlans: Array.from(this.activePlans.values()),
    });

    if (assessment.requiresAction && assessment.confidence > this.config.safetyThreshold) {
      const plan = await this.actionPlanner.createPlan({
        type: 'autonomous',
        goal: assessment.recommendedAction,
        urgency: assessment.urgency,
      });

      if (
        this.config.autonomyLevel === 'full' ||
        (this.config.autonomyLevel === 'semi' && assessment.urgency === 'critical')
      ) {
        return await this.executePlan(plan);
      } else {
        // Notify user of recommended action
        this.notifyUserOfRecommendation(assessment, plan);
      }
    }

    return assessment;
  }

  async executePlan(plan) {
    const executionId = this.generateExecutionId();

    this.activePlans.set(executionId, {
      ...plan,
      status: 'executing',
      startedAt: Date.now(),
    });

    try {
      const results = [];

      for (const action of plan.actions) {
        // Check if plan was cancelled
        if (this.activePlans.get(executionId)?.status === 'cancelled') {
          throw new Error('Plan cancelled');
        }

        // Execute action through appropriate agent
        const result = await this.executeAction(action);
        results.push(result);

        // Update plan progress
        this.activePlans.get(executionId).progress = results.length / plan.actions.length;
      }

      const completed = {
        executionId,
        status: 'completed',
        results,
        completedAt: Date.now(),
      };

      this.activePlans.set(executionId, completed);

      // Learn from execution
      if (this.config.learningEnabled) {
        await this.learnFromExecution(plan, results);
      }

      return completed;
    } catch (error) {
      this.activePlans.set(executionId, {
        executionId,
        status: 'failed',
        error: error.message,
        failedAt: Date.now(),
      });

      // Attempt recovery
      if (plan.canRecover) {
        return await this.attemptRecovery(plan, error);
      }

      throw error;
    }
  }

  async executeAction(action) {
    const agent = this.core?.agents.get(action.agent);
    if (!agent) throw new Error(`Agent ${action.agent} not available`);

    // Execute with timeout and retry
    const maxRetries = action.maxRetries || 2;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await Promise.race([
          agent[action.method](action.params),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), action.timeout || 30000)
          ),
        ]);

        return { action, result, attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      }
    }

    throw lastError;
  }

  async learnFromExecution(plan, results) {
    // Update learning model with execution results
    const features = this.extractFeatures(plan, results);

    // Store for batch learning
    await this.storeLearningData({
      plan,
      results,
      features,
      timestamp: Date.now(),
    });

    // Online learning for immediate adaptation
    this.learningModel?.partialFit(features, results);
  }

  determineAutonomyLevel(intent) {
    const levels = {
      none: 0,
      assisted: 1,
      semi: 2,
      full: 3,
    };

    // Determine based on intent risk and user preferences
    if (intent.type === 'billing' && intent.action === 'purchase') return 1;
    if (intent.type === 'network' && intent.action === 'disconnect') return 2;
    if (intent.urgency === 'critical') return 3;

    return levels[this.config.autonomyLevel] || 1;
  }

  getAutonomyValue(level) {
    return { none: 0, assisted: 1, semi: 2, full: 3 }[level] || 1;
  }

  canExecuteImmediately(plan) {
    return this.activePlans.size < this.config.maxConcurrentActions;
  }

  async queuePlan(plan) {
    const queued = {
      ...plan,
      status: 'queued',
      queuedAt: Date.now(),
    };

    // Add to priority queue
    this.actionPlanner.queue(queued);

    return { status: 'queued', position: this.actionPlanner.queueLength() };
  }

  generateExecutionId() {
    return `ai-exec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async activate() {
    this.autonomyEngine.start();
  }

  async deactivate() {
    // Cancel non-critical plans
    for (const [id, plan] of this.activePlans) {
      if (plan.urgency !== 'critical') {
        plan.status = 'cancelled';
      }
    }

    this.autonomyEngine.stop();
  }
}

export default AIOrchestrator;
