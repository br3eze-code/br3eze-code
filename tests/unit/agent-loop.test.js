import { describe, expect, test } from '@jest/globals';
import { AgentLoop, TURN_STATES } from '../../src/core/agent-loop.js';

describe('AgentLoop', () => {
  test('enforces the canonical execution lifecycle', () => {
    const loop = new AgentLoop();
    loop.transition(TURN_STATES.UNDERSTANDING);
    loop.transition(TURN_STATES.PLANNING);
    loop.transition(TURN_STATES.EXECUTING);
    loop.transition(TURN_STATES.OBSERVING);
    loop.transition(TURN_STATES.EVALUATING);
    loop.transition(TURN_STATES.VERIFYING);
    loop.transition(TURN_STATES.COMPLETED);
    expect(loop.state).toBe(TURN_STATES.COMPLETED);
    expect(loop.history).toHaveLength(7);
  });

  test('supports bounded retry and rejects invalid transitions', () => {
    const loop = new AgentLoop({ maxRetries: 1 });
    loop.transition(TURN_STATES.UNDERSTANDING);
    loop.transition(TURN_STATES.EXECUTING);
    loop.transition(TURN_STATES.RETRYING);
    loop.transition(TURN_STATES.EXECUTING);
    expect(() => loop.retry()).toThrow(/Maximum retries/);
    expect(() => loop.transition(TURN_STATES.CREATED)).toThrow(/Invalid turn transition/);
  });
});
