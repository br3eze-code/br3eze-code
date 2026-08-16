const DEFAULTS = Object.freeze({
  cooldownMs: 15 * 60 * 1000,
  maxPerHour: 3,
  quietStartHour: 22,
  quietEndHour: 7,
});

function hourInZone(date, timeZone = 'UTC') {
  try {
    return Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hour12: false, timeZone }).format(date));
  } catch {
    return date.getUTCHours();
  }
}

function isQuietHour(hour, start, end) {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

export function evaluateProactiveNotification({ proposal, context = {}, history = [], now = Date.now(), policy = {} } = {}) {
  const config = { ...DEFAULTS, ...policy };
  const userDoc = context.userDoc || {};
  const optedOut = context.proactiveOptOut === true || userDoc.proactiveOptOut === true;
  if (optedOut) return { allowed: false, reason: 'user_opted_out', speakNow: false };
  if (!proposal?.valid || !proposal?.candidates?.length) return { allowed: false, reason: 'invalid_proposal', speakNow: false };

  const nowDate = new Date(now);
  const hour = hourInZone(nowDate, context.timeZone || userDoc.timeZone || 'UTC');
  if (!context.allowQuietHoursBypass && isQuietHour(hour, config.quietStartHour, config.quietEndHour)) {
    return { allowed: false, reason: 'quiet_hours', speakNow: false, nextReviewAt: new Date(now + config.cooldownMs).toISOString() };
  }

  const recent = history.filter((event) => now - Date.parse(event.createdAt || 0) < 60 * 60 * 1000);
  if (recent.length >= config.maxPerHour) return { allowed: false, reason: 'notification_budget_exhausted', speakNow: false };
  const sameProposal = history.find((event) => event.proposalId === proposal.proposalId && now - Date.parse(event.createdAt || 0) < config.cooldownMs);
  if (sameProposal) return { allowed: false, reason: 'cooldown', speakNow: false };

  const top = proposal.candidates[0];
  const speakNow = Boolean(proposal.speakNow && top.confidence >= 0.85 && top.risk !== 'high');
  return {
    allowed: true,
    reason: 'policy_allowed',
    speakNow,
    controls: [
      'continue',
      'clarify',
      ...(top.requiresApproval ? ['approve'] : []),
      'snooze',
      'dismiss',
    ],
    expiresAt: proposal.expiresAt,
  };
}

export function recordProactiveDecision({ proposalId, decision, userId = null, channel = null, now = Date.now() } = {}) {
  const allowed = new Set(['continue', 'clarify', 'approve', 'snooze', 'dismiss']);
  if (!allowed.has(decision)) throw Object.assign(new Error('Unsupported proactive decision'), { code: 'PROACTIVE_DECISION_INVALID', status: 400 });
  return { proposalId, decision, userId, channel, createdAt: new Date(now).toISOString() };
}

export { DEFAULTS as PROACTIVE_POLICY_DEFAULTS };
export default { evaluateProactiveNotification, recordProactiveDecision };
