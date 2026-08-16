const MAX_EVENTS = 1000;

export class ProactiveTelemetry {
  constructor({ maxEvents = MAX_EVENTS } = {}) {
    this.maxEvents = maxEvents;
    this.events = [];
  }

  record(event = {}) {
    const normalized = {
      eventId: event.eventId || `pe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: event.type || 'proposal_created',
      proposalId: event.proposalId || null,
      taskId: event.taskId || null,
      userId: event.userId || null,
      channel: event.channel || null,
      actionId: event.actionId || null,
      confidence: Number.isFinite(event.confidence) ? event.confidence : null,
      risk: event.risk || null,
      safe: event.safe !== false,
      createdAt: event.createdAt || new Date().toISOString(),
    };
    this.events.push(normalized);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    return normalized;
  }

  list({ userId = null, taskId = null, limit = 100 } = {}) {
    return this.events.filter((event) => (!userId || event.userId === userId) && (!taskId || event.taskId === taskId)).slice(-limit);
  }

  summary({ userId = null } = {}) {
    const events = this.list({ userId, limit: this.maxEvents });
    const count = (type) => events.filter((event) => event.type === type).length;
    const proposed = count('proposal_created');
    const accepted = count('proposal_accepted');
    return {
      total: events.length,
      proposed,
      accepted,
      dismissed: count('proposal_dismissed'),
      clarified: count('proposal_clarified'),
      snoozed: count('proposal_snoozed'),
      executed: count('action_executed'),
      blocked: count('action_blocked'),
      unsafe: events.filter((event) => event.safe === false).length,
      acceptanceRate: proposed ? Number((accepted / proposed).toFixed(3)) : 0,
    };
  }
}

export default ProactiveTelemetry;
