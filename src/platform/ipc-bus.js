import { EventEmitter } from 'node:events';

/** In-process IPC with explicit topic allowlists and payload-size bounds. */
export class IpcBus {
  #events = new EventEmitter();
  #topics = new Set();
  #maxPayloadBytes;

  constructor({ topics = [], maxPayloadBytes = 64 * 1024 } = {}) {
    if (!Array.isArray(topics) || topics.some((topic) => typeof topic !== 'string' || !topic.trim())) throw new TypeError('topics must be non-empty strings');
    if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1) throw new TypeError('maxPayloadBytes must be a positive safe integer');
    this.#topics = new Set(topics);
    this.#maxPayloadBytes = maxPayloadBytes;
    this.#events.setMaxListeners(100);
  }

  subscribe(topic, handler) {
    this.#assertTopic(topic);
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    this.#events.on(topic, handler);
    return () => this.#events.off(topic, handler);
  }

  publish(topic, payload, { principal, policy } = {}) {
    this.#assertTopic(topic);
    if (policy) policy.assert(principal, `ipc.publish.${topic}`);
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) throw new TypeError('IPC payload must be JSON-serializable');
    if (Buffer.byteLength(serialized, 'utf8') > this.#maxPayloadBytes) {
      const error = new Error('IPC payload exceeds configured limit');
      error.code = 'IPC_PAYLOAD_TOO_LARGE';
      throw error;
    }
    const envelope = Object.freeze({ topic, payload: JSON.parse(serialized), principal: principal || null, timestamp: Date.now() });
    this.#events.emit(topic, envelope);
    return envelope;
  }

  #assertTopic(topic) {
    if (!this.#topics.has(topic)) {
      const error = new Error(`IPC topic is not registered: ${topic}`);
      error.code = 'IPC_TOPIC_NOT_REGISTERED';
      throw error;
    }
  }
}
