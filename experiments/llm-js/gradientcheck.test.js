import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";
import { crossEntropy } from "./ops.js";

test("cross-entropy analytic gradients agree with finite differences", () => {
  const values = [0.2, -0.7, 1.1];
  const target = 2;
  const logits = Tensor.vector(values);
  const loss = crossEntropy(logits, target);
  loss.backward();
  const epsilon = 1e-5;
  for (let index = 0; index < values.length; index += 1) {
    const plus = [...values];
    const minus = [...values];
    plus[index] += epsilon;
    minus[index] -= epsilon;
    const high = crossEntropy(Tensor.vector(plus), target).value;
    const low = crossEntropy(Tensor.vector(minus), target).value;
    const numeric = (high - low) / (2 * epsilon);
    assert.ok(Math.abs(logits.grad[index] - numeric) < 1e-6,
      `gradient mismatch at ${index}: analytic=${logits.grad[index]}, numeric=${numeric}`);
  }
});
