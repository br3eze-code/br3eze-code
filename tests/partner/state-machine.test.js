import { describe, expect, test } from '@jest/globals';
import { canTransition, transitionJob } from '../../services/partner/state-machine.mjs';

describe('partner job state machine', () => {
  test('allows the normal lifecycle', () => {
    expect(canTransition('created', 'funded')).toBe(true);
    expect(canTransition('funded', 'working')).toBe(true);
    expect(canTransition('working', 'verifying')).toBe(true);
    expect(canTransition('human_review', 'released')).toBe(true);
  });

  test('rejects direct release from funded', () => {
    expect(canTransition('funded', 'released')).toBe(false);
    expect(() => transitionJob({ status: 'funded' }, 'released')).toThrow(/Invalid job transition/);
  });
});
