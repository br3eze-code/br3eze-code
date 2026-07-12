/**
 * Billing Agent - Manages WiFi billing sessions, usage tracking, and payments
 */

import UsageTracker from './UsageTracker.js';
import RateCalculator from './RateCalculator.js';
import SessionManager from './SessionManager.js';
import EventEmitter from 'events';

class BillingAgent extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      currency: config.currency || 'USD',
      defaultRate: config.defaultRate || 0.1, // per minute
      billingInterval: config.billingInterval || 60000, // 1 minute
      gracePeriod: config.gracePeriod || 30000, // 30 seconds
      ...config,
    };

    this.id = `billing-agent-${Date.now()}`;
    this.usageTracker = new UsageTracker(this.config);
    this.rateCalculator = new RateCalculator(this.config);
    this.sessionManager = new SessionManager(this.config);

    this.activeSessions = new Map();
    this.billingTimer = null;
  }

  async initialize() {
    await this.usageTracker.initialize();
    await this.rateCalculator.initialize();
    await this.sessionManager.initialize();

    // Restore any persisted sessions
    await this.restoreSessions();
  }

  async startSession(options) {
    const { userId, planId, ssid, rateOverride, timeLimit, dataLimit, autoRenew = false } = options;

    // Validate user plan
    const plan = await this.validatePlan(userId, planId);
    if (!plan.valid) {
      throw new Error(`Invalid plan: ${plan.reason}`);
    }

    const sessionId = this.generateSessionId();
    const rate = rateOverride || plan.rate || this.config.defaultRate;

    const session = {
      id: sessionId,
      userId,
      planId,
      ssid,
      rate,
      currency: this.config.currency,
      startTime: Date.now(),
      timeLimit: timeLimit || plan.timeLimit,
      dataLimit: dataLimit || plan.dataLimit,
      autoRenew,
      state: 'active',
      usage: {
        timeMinutes: 0,
        dataBytes: 0,
        cost: 0,
      },
    };

    this.activeSessions.set(sessionId, session);

    // Persist session
    await this.sessionManager.saveSession(session);

    // Start usage tracking
    this.usageTracker.startTracking(sessionId, ssid);

    // Start billing cycle
    this.startBillingCycle();

    this.emit('billing:session_started', session);

    return session;
  }

  async endSession(sessionId, reason = 'user_request') {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error('Session not found');

    // Final usage calculation
    const finalUsage = await this.usageTracker.stopTracking(sessionId);

    // Calculate final cost
    const finalCost = this.rateCalculator.calculate(session, finalUsage);

    const completedSession = {
      ...session,
      endTime: Date.now(),
      reason,
      finalUsage,
      finalCost,
      state: 'completed',
    };

    // Process payment if needed
    if (finalCost > 0) {
      await this.processPayment(completedSession);
    }

    this.activeSessions.delete(sessionId);
    await this.sessionManager.archiveSession(completedSession);

    this.emit('billing:session_ended', completedSession);

    return completedSession;
  }

  async pauseSession(sessionId, reason = 'user_request') {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.state !== 'active') {
      throw new Error('Cannot pause inactive session');
    }

    session.state = 'paused';
    session.pauseTime = Date.now();

    await this.usageTracker.pauseTracking(sessionId);
    await this.sessionManager.updateSession(session);

    this.emit('billing:session_paused', { sessionId, reason });

    return session;
  }

  async resumeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.state !== 'paused') {
      throw new Error('Cannot resume non-paused session');
    }

    const pausedDuration = Date.now() - session.pauseTime;
    session.totalPaused = (session.totalPaused || 0) + pausedDuration;
    session.state = 'active';
    delete session.pauseTime;

    await this.usageTracker.resumeTracking(sessionId);
    await this.sessionManager.updateSession(session);

    this.emit('billing:session_resumed', { sessionId });

    return session;
  }

  async getSessionStatus(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      const archived = await this.sessionManager.getArchivedSession(sessionId);
      return archived ? { ...archived, active: false } : null;
    }

    const currentUsage = await this.usageTracker.getCurrentUsage(sessionId);
    const remaining = this.calculateRemaining(session, currentUsage);

    return {
      active: true,
      sessionId,
      state: session.state,
      ...currentUsage,
      ...remaining,
      currentCost: this.rateCalculator.calculate(session, currentUsage),
    };
  }

  calculateRemaining(session, usage) {
    const remaining = {};

    if (session.timeLimit) {
      const elapsedMinutes = (Date.now() - session.startTime - (session.totalPaused || 0)) / 60000;
      remaining.remainingMinutes = Math.max(0, session.timeLimit - elapsedMinutes);
    }

    if (session.dataLimit) {
      remaining.remainingDataBytes = Math.max(0, session.dataLimit - usage.dataBytes);
      remaining.remainingDataMB = remaining.remainingDataBytes / (1024 * 1024);
    }

    return remaining;
  }

  startBillingCycle() {
    if (this.billingTimer) return;

    this.billingTimer = setInterval(async () => {
      for (const [sessionId, session] of this.activeSessions) {
        if (session.state !== 'active') continue;

        try {
          const usage = await this.usageTracker.getCurrentUsage(sessionId);
          const cost = this.rateCalculator.calculate(session, usage);

          session.usage = usage;
          session.usage.cost = cost;

          // Check limits
          if (session.timeLimit && usage.timeMinutes >= session.timeLimit) {
            await this.handleTimeLimitReached(session);
          }

          if (session.dataLimit && usage.dataBytes >= session.dataLimit) {
            await this.handleDataLimitReached(session);
          }

          // Low balance warning
          if (session.remainingMinutes < 5) {
            this.emit('billing:time_low', { sessionId, minutes: session.remainingMinutes });
          }

          await this.sessionManager.updateSession(session);
        } catch (error) {
          this.emit('billing:error', { sessionId, error });
        }
      }
    }, this.config.billingInterval);
  }

  async handleTimeLimitReached(session) {
    if (session.autoRenew) {
      // Attempt to renew
      const renewed = await this.attemptRenewal(session);
      if (!renewed) {
        await this.endSession(session.id, 'time_limit_reached');
      }
    } else {
      // Grace period then disconnect
      setTimeout(async () => {
        await this.endSession(session.id, 'time_limit_reached');
      }, this.config.gracePeriod);
    }
  }

  async handleDataLimitReached(session) {
    // Throttle or disconnect based on plan
    await this.endSession(session.id, 'data_limit_reached');
  }

  async attemptRenewal(session) {
    // Check if user has credits for renewal
    const canRenew = await this.checkRenewalEligibility(session);
    if (!canRenew) return false;

    // Extend session
    session.timeLimit += session.originalTimeLimit || 60;
    this.emit('billing:session_renewed', { sessionId: session.id });
    return true;
  }

  async validatePlan(userId, planId) {
    // Check against auth agent or backend
    // Simplified for now
    return {
      valid: true,
      rate: this.config.defaultRate,
      timeLimit: 60,
      dataLimit: 1024 * 1024 * 1024, // 1GB
    };
  }

  async processPayment(session) {
    // Integrate with payment gateway
    this.emit('billing:payment_required', {
      sessionId: session.id,
      amount: session.finalCost,
      currency: session.currency,
    });
  }

  generateSessionId() {
    return `pc-sess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async restoreSessions() {
    const persisted = await this.sessionManager.getActiveSessions();
    for (const session of persisted) {
      if (session.state === 'active') {
        // Resume tracking
        this.activeSessions.set(session.id, session);
        this.usageTracker.startTracking(session.id, session.ssid);
      }
    }
  }

  emit(event, data) {
    // Event emission
    if (this.core) {
      this.core.eventBus.emit(event, data);
    }
  }

  async activate() {
    this.startBillingCycle();
  }

  async deactivate() {
    clearInterval(this.billingTimer);
    // Pause all active sessions
    for (const [sessionId] of this.activeSessions) {
      await this.pauseSession(sessionId, 'agent_deactivation');
    }
  }
}

export default BillingAgent;
