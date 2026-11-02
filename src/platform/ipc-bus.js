import { IPCMessageBus } from '../core/os/IPCMessageBus.js';

/**
 * Compatibility facade for the original topic-based platform API.
 * Tenant-scoped delivery, payload validation, audit and authorization are
 * implemented once by the canonical core OS IPC bus.
 */
export class IpcBus {
  constructor({ topics = [], maxPayloadBytes = 64 * 1024, maxSubscribers = 1024, authorize, onAudit } = {}) {
    if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== 'string' || !topic.trim())) {
      throw new TypeError('topics must be non-empty strings');
    }
    this.topics = new Set(topics);
    this.nextSubscriberId = 0;
    if (authorize !== undefined && typeof authorize !== 'function') throw new TypeError('authorize must be a function');
    this.core = new IPCMessageBus({
      maxPayloadBytes,
      maxSubscribers,
      onAudit,
      authorize: async (context) => this.topics.has(context.topic) && (authorize ? await authorize(context) : true),
    });
  }

  async subscribe(topic, handler) {
    this.#assertTopic(topic);
    return this.core.subscribe({
      topic,
      subscriberId: `platform-subscriber-${++this.nextSubscriberId}`,
      tenantId: 'platform-local',
      userId: 'platform-system',
    }, handler);
  }

  async publish(topic, payload, { principal, policy } = {}) {
    this.#assertTopic(topic);
    if (policy) policy.assert(principal, `ipc.publish.${topic}`);
    return this.core.publish({
      topic,
      publisherId: principal || 'platform-system',
      tenantId: 'platform-local',
      userId: principal || 'platform-system',
    }, payload);
  }

  #assertTopic(topic) {
    if (!this.topics.has(topic)) {
      const error = new Error(`IPC topic is not registered: ${topic}`);
      error.code = 'IPC_TOPIC_NOT_REGISTERED';
      throw error;
    }
  }
}

export default IpcBus;
