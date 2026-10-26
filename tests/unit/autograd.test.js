import { Value, softmax, sum } from '../../src/llm/autograd.js';

describe('scalar autograd', () => {
  test('propagates gradients through a simple expression', () => {
    const x = new Value(3);
    const y = x.mul(x).add(x).relu();
    y.backward();

    expect(y.data).toBe(12);
    expect(x.grad).toBe(7);
  });

  test('accumulates gradients when a node is used more than once', () => {
    const x = new Value(2);
    const y = x.mul(x).add(x.mul(3));
    y.backward();

    expect(y.data).toBe(10);
    expect(x.grad).toBe(7);
  });

  test('supports tanh, exp, and log derivatives', () => {
    const x = new Value(0.5);
    const y = x.tanh().add(x.exp().log());
    y.backward();

    expect(y.data).toBeCloseTo(Math.tanh(0.5) + 0.5, 10);
    expect(x.grad).toBeCloseTo((1 - Math.tanh(0.5) ** 2) + 1, 10);
  });

  test('softmax outputs sum to one and supports backward', () => {
    const logits = [new Value(1), new Value(2), new Value(3)];
    const probabilities = softmax(logits);
    const total = sum(probabilities);

    expect(total.data).toBeCloseTo(1, 12);
    probabilities[2].backward();
    expect(logits[2].grad).toBeGreaterThan(0);
    expect(logits[0].grad).toBeLessThan(0);
    expect(logits[1].grad).toBeLessThan(0);
  });

  test('rejects invalid numeric operations', () => {
    expect(() => new Value(Number.NaN)).toThrow(/finite number/);
    expect(() => new Value(1).div(0)).toThrow(/Division by zero/);
    expect(() => new Value(0).log()).toThrow(/positive value/);
  });
});
