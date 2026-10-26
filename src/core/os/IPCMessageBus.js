const TOPIC = /^[a-z][a-z0-9._*-]{0,127}$/i;
const MAX_SUBSCRIBERS = 2048;

function assertTopic(topic) {
  if (typeof topic !== 'string' || !TOPIC.test(topic)) throw new TypeError('IPC topic must be a stable identifier');
}

function assertPrincipalField(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || [...value].some((character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127; })) {
    throw new TypeError(`${label} must be a non-empty string of at most 128 safe characters`);
  }
}

function isSafePayload(value, depth = 0) {
  if (depth > 32) return false;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value !== 'number' || Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 10000 && value.every((item) => isSafePayload(item, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value);
  return entries.length <= 1000 && entries.every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && isSafePayload(item, depth + 1));
}

/** In-process IPC contract. Remote transports must preserve this authorization boundary. */
export class IPCMessageBus {
  constructor({ maxSubscribers = MAX_SUBSCRIBERS, maxPayloadBytes = 1024 * 1024, authorize = () => false, onAudit = () => {} } = {}) {
    if (!Number.isInteger(maxSubscribers) || maxSubscribers < 1) throw new RangeError('maxSubscribers must be positive');
    if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 1 || maxPayloadBytes > 16 * 1024 * 1024) throw new RangeError('maxPayloadBytes must be between 1 byte and 16 MiB');
    if (typeof authorize !== 'function') throw new TypeError('IPC authorize must be a trusted host policy function');
    if (typeof onAudit !== 'function') throw new TypeError('IPC onAudit must be a function');
    this.maxSubscribers = maxSubscribers;
    this.maxPayloadBytes = maxPayloadBytes;
    this.authorize = authorize;
    this.onAudit = onAudit;
    this.subscriptions = new Map();
  }

  async #assertAuthorized(action, topic, principal) {
    let allowed = false;
    try { allowed = await this.authorize({ action, topic, ...principal }) === true; }
    catch { allowed = false; }
    if (!allowed) throw new Error(`missing_permission:ipc.${action}:${topic}`);
  }

  async subscribe({ topic, subscriberId, tenantId, userId } = {}, handler) {
    assertTopic(topic);
    assertPrincipalField(subscriberId, 'subscriberId');
    assertPrincipalField(tenantId, 'tenantId');
    assertPrincipalField(userId, 'userId');
    if (typeof handler !== 'function') throw new TypeError('IPC handler must be a function');
    await this.#assertAuthorized('subscribe', topic, { principalId: subscriberId, tenantId, userId });
    if (this.subscriptions.size >= this.maxSubscribers) throw new Error('IPC subscriber limit reached');
    const id = JSON.stringify([tenantId, subscriberId, topic]);
    if (this.subscriptions.has(id)) throw new Error(`IPC subscription already exists: ${id}`);
    this.subscriptions.set(id, { id, topic, subscriberId, tenantId, userId, handler });
    let active = true;
    return () => { if (active) { active = false; this.subscriptions.delete(id); } };
  }

  async publish({ topic, publisherId, tenantId, userId, correlationId = null } = {}, payload) {
    assertTopic(topic);
    assertPrincipalField(publisherId, 'publisherId');
    assertPrincipalField(tenantId, 'tenantId');
    assertPrincipalField(userId, 'userId');
    if (correlationId !== null && (typeof correlationId !== 'string' || correlationId.length > 128 || [...correlationId].some((character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127; }))) throw new TypeError('correlationId must be a safe string of at most 128 characters');
    await this.#assertAuthorized('publish', topic, { principalId: publisherId, tenantId, userId });
    if (!isSafePayload(payload)) throw new TypeError('IPC payload must be bounded JSON-compatible data');
    let serialized;
    try { serialized = JSON.stringify(payload); } catch { throw new TypeError('IPC payload must be serializable JSON data'); }
    if (Buffer.byteLength(serialized, 'utf8') > this.maxPayloadBytes) throw new RangeError('IPC payload exceeds configured byte limit');
    const envelope = Object.freeze({
      topic, publisherId, tenantId, userId, correlationId,
      timestamp: new Date().toISOString(),
      payload: structuredClone(payload),
    });
    const targets = [...this.subscriptions.values()].filter((s) => s.topic === topic && s.tenantId === tenantId);
    const results = await Promise.allSettled(targets.map((target) => target.handler(structuredClone(envelope))));
    try { this.onAudit({ type: 'ipc.publish', topic, tenantId, publisherId, delivered: results.filter((r) => r.status === 'fulfilled').length, rejected: results.filter((r) => r.status === 'rejected').length }); } catch {}
    return { delivered: results.filter((r) => r.status === 'fulfilled').length, rejected: results.filter((r) => r.status === 'rejected').length };
  }

  listSubscriptions({ tenantId } = {}) {
    return [...this.subscriptions.values()].filter((item) => !tenantId || item.tenantId === tenantId)
      .map(({ id, topic, subscriberId, tenantId: ownerTenant }) => ({ id, topic, subscriberId, tenantId: ownerTenant }));
  }
}

export default IPCMessageBus;
