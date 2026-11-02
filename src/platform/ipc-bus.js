import { IPCMessageBus } from '../core/os/IPCMessageBus.js';

/**
 * Compatibility facade for the original topic-based platform API.
 * Tenant-scoped delivery, payload validation, audit and authorization are
 * implemented once by the canonical core OS IPC bus.
 */
export class IpcBus {
  constructor({ topics = [], maxPayloadBytes = 64 * 1024 } = {}) {
    if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== 'string' || !topic.trim())) {
      throw new TypeError('topics must be non-empty strings');
    }
    this.topics = new Set(topics);
    this.core = new IPCMessageBus({
      maxPayloadBytes,
      authorize: ({ topic }) => this.topics.has(topic),
    });
  }

  async subscribe(topic, handler) {
    this.#assertTopic(topic);
    return this.core.subscribe({
      topic,
      subscriberId: 'platform-subscriber',
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
