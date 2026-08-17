import crypto from 'node:crypto';

const HEALTH_CAPABILITY = 'router.health.read';

function required(value, name) {
  if (value == null || value === '') throw new TypeError(`${name} is required`);
  return String(value);
}

function parseSelectors(tokens) {
  const selectors = { tenantId: null, siteIds: [], routerIds: [] };
  for (const token of tokens) {
    const [key, ...rest] = token.split('=');
    const value = rest.join('=').trim();
    if (!value) continue;
    if (key === 'tenant') selectors.tenantId = value;
    else if (key === 'site') selectors.siteIds = value.split(',').map((item) => item.trim()).filter(Boolean);
    else if (key === 'router') selectors.routerIds = value.split(',').map((item) => item.trim()).filter(Boolean);
    else throw new Error(`unsupported health selector: ${key}`);
  }
  return selectors;
}

export function parseTelegramHealthUpdate(update) {
  const updateId = update?.update_id;
  const message = update?.message;
  const text = message?.text;
  const telegramUserId = message?.from?.id;
  const chatId = message?.chat?.id;
  if (updateId == null || text == null || telegramUserId == null || chatId == null) throw new Error('invalid Telegram health update');
  const tokens = String(text).trim().split(/\s+/);
  if (tokens[0] !== '/health') throw new Error('unsupported Telegram command');
  const selectors = parseSelectors(tokens.slice(1));
  return Object.freeze({
    updateId: String(updateId),
    source: 'telegram',
    channelIdentityId: `telegram:${chatId}`,
    telegramUserId: String(telegramUserId),
    chatId: String(chatId),
    capability: HEALTH_CAPABILITY,
    command: 'health',
    ...selectors
  });
}

export class HealthChannelIngress {
  constructor({ resolvePrincipal, enqueueWork, seenUpdates = new Set(), idFactory = () => crypto.randomUUID() } = {}) {
    if (typeof resolvePrincipal !== 'function') throw new TypeError('resolvePrincipal is required');
    if (typeof enqueueWork !== 'function') throw new TypeError('enqueueWork is required');
    this.resolvePrincipal = resolvePrincipal;
    this.enqueueWork = enqueueWork;
    this.seenUpdates = seenUpdates;
    this.idFactory = idFactory;
  }

  async accept(update) {
    const parsed = parseTelegramHealthUpdate(update);
    if (this.seenUpdates.has(parsed.updateId)) return { status: 'duplicate', updateId: parsed.updateId };
    const principal = await this.resolvePrincipal({ channelIdentityId: parsed.channelIdentityId, telegramUserId: parsed.telegramUserId });
    if (!principal?.principalId) return { status: 'rejected', code: 'UNKNOWN_PRINCIPAL', updateId: parsed.updateId };
    this.seenUpdates.add(parsed.updateId);
    const work = Object.freeze({
      workId: `work_${this.idFactory()}`,
      goal: 'Check authorized router health',
      acceptanceCriteria: ['return tenant/site/router-scoped health evidence'],
      source: parsed.source,
      channelIdentityId: parsed.channelIdentityId,
      principalId: principal.principalId,
      tenantId: parsed.tenantId,
      siteIds: parsed.siteIds,
      routerIds: parsed.routerIds,
      capability: parsed.capability,
      input: parsed
    });
    await this.enqueueWork(work);
    return { status: 'accepted', updateId: parsed.updateId, workId: work.workId };
  }
}

export { HEALTH_CAPABILITY };
export default HealthChannelIngress;
