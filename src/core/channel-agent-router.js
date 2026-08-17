export class ChannelAgentRouter {
  constructor({ channelManager }) {
    this.channelManager = channelManager;
  }

  async dispatch(handoff, { userId, channel, tenantId }) {
    if (!handoff || handoff.status !== 'proposed' && handoff.status !== 'accepted') {
      return { delivered: false, code: 'INVALID_HANDOFF_STATUS' };
    }
    if (!userId || !channel || !tenantId) {
      return { delivered: false, code: 'MISSING_CHANNEL_SCOPE' };
    }
    if (handoff.tenantId !== tenantId) {
      return { delivered: false, code: 'TENANT_SCOPE_MISMATCH' };
    }
    const message = {
      text: `Handoff to ${handoff.to}: ${handoff.requestedAction}`,
      metadata: {
        type: 'specialist-handoff',
        handoffId: handoff.handoffId,
        workId: handoff.workId,
        loopId: handoff.loopId,
        parentExecutionId: handoff.parentExecutionId,
        from: handoff.from,
        to: handoff.to,
        acceptanceCriteria: handoff.acceptanceCriteria,
        evidence: handoff.evidence,
      },
    };
    await this.channelManager.send(channel, userId, message);
    return { delivered: true, channel, userId, handoffId: handoff.handoffId };
  }
}
