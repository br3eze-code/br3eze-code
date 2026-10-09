/**
 * Canonical AgentOS turn lifecycle.
 *
 * Domain-neutral state machine used by runtimes to make execution state
 * observable and testable without coupling the core to a model/provider.
 */
export const TURN_STATES = Object.freeze({
  CREATED: 'created',
  UNDERSTANDING: 'understanding',
  PLANNING: 'planning',
  EXECUTING: 'executing',
  OBSERVING: 'observing',
  EVALUATING: 'evaluating',
  HANDOFF: 'handoff',
  RETRYING: 'retrying',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TRANSITIONS = Object.freeze({
  [TURN_STATES.CREATED]: [TURN_STATES.UNDERSTANDING, TURN_STATES.FAILED, TURN_STATES.CANCELLED],
  [TURN_STATES.UNDERSTANDING]: [TURN_STATES.PLANNING, TURN_STATES.EXECUTING, TURN_STATES.FAILED, TURN_STATES.CANCELLED],
  [TURN_STATES.PLANNING]: [TURN_STATES.EXECUTING, TURN_STATES.HANDOFF, TURN_STATES.FAILED, TURN_STATES.CANCELLED],
  [TURN_STATES.EXECUTING]: [TURN_STATES.OBSERVING, TURN_STATES.HANDOFF, TURN_STATES.RETRYING, TURN_STATES.FAILED, TURN_STATES.CANCELLED],
  [TURN_STATES.OBSERVING]: [TURN_STATES.EVALUATING, TURN_STATES.RETRYING, TURN_STATES.FAILED, TURN_STATES.CANCELLED],
  [TURN_STATES.EVALUATING]: [TURN_STATES.VERIFYING, TURN_STATES.RETRYING, TURN_STATES.HANDOFF, TURN_STATES.COMPLETED, TURN_STATES.FAILED],
  [TURN_STATES.HANDOFF]: [TURN_STATES.PLANNING, TURN_STATES.EXECUTING, TURN_STATES.FAILED, TURN_STATES.CANCELLED],
  [TURN_STATES.RETRYING]: [TURN_STATES.EXECUTING, TURN_STATES.FAILED, TURN_STATES.CANCELLED],
  [TURN_STATES.VERIFYING]: [TURN_STATES.COMPLETED, TURN_STATES.RETRYING, TURN_STATES.FAILED],
  [TURN_STATES.COMPLETED]: [],
  [TURN_STATES.FAILED]: [],
  [TURN_STATES.CANCELLED]: [],
});

export class AgentLoop {
  constructor({ initialState = TURN_STATES.CREATED, maxRetries = 2, clock = () => new Date().toISOString() } = {}) {
    if (!TRANSITIONS[initialState]) throw new TypeError(`Unknown turn state: ${initialState}`);
    this.state = initialState;
    this.maxRetries = maxRetries;
    this.retryCount = 0;
    this.history = [];
    this.clock = clock;
  }

  canTransition(to) {
    return TRANSITIONS[this.state]?.includes(to) || false;
  }

  transition(to, meta = {}) {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid turn transition: ${this.state} -> ${to}`);
    }
    const from = this.state;
    this.state = to;
    if (to === TURN_STATES.RETRYING) this.retryCount += 1;
    const event = Object.freeze({
      from,
      to,
      retryCount: this.retryCount,
      timestamp: this.clock(),
      meta: { ...meta },
    });
    this.history.push(event);
    return event;
  }

  retry(meta = {}) {
    if (this.retryCount >= this.maxRetries) {
      throw new Error(`Maximum retries exceeded: ${this.maxRetries}`);
    }
    return this.transition(TURN_STATES.RETRYING, meta);
  }

  snapshot() {
    return {
      state: this.state,
      retryCount: this.retryCount,
      maxRetries: this.maxRetries,
      history: this.history.map((event) => ({ ...event, meta: { ...event.meta } })),
    };
  }
}

export function createAgentLoop(options) {
  return new AgentLoop(options);
}

export default AgentLoop;
