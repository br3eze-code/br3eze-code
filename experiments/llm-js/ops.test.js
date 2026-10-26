import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";
import { crossEntropy, embedding, softmax } from "./ops.js";

const close = (actual, expected, epsilon = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`);
};

test("embedding gathers token rows and scatter-adds gradients", () => {
  const table = Tensor.matrix([[1, 2], [3, 4], [5, 6]]);
  const tokens = embedding(table, [2, 0, 2]);
  assert.deepEqual(tokens.toArray(), [[5, 6], [1, 2], [5, 6]]);
  tokens.sum().backward();
  assert.deepEqual(Array.from(table.grad), [1, 1, 0, 0, 2, 2]);
});

test("softmax is normalized and backpropagates", () => {
  const logits = Tensor.vector([1, 2, 3]);
  const probabilities = softmax(logits);
  close(probabilities.data.reduce((sum, value) => sum + value, 0), 1);
  probabilities.backward(new Float64Array([1, 0, 0]));
  assert.ok(logits.grad.every(Number.isFinite));
  close(logits.grad.reduce((sum, value) => sum + value, 0), 0);
});

test("cross entropy has stable loss and expected logit gradient", () => {
  const logits = Tensor.vector([1000, 1001, 999]);
  const loss = crossEntropy(logits, 1);
  assert.ok(Number.isFinite(loss.value));
  loss.backward();
  const probs = softmax(Tensor.vector([1000, 1001, 999]));
  for (let i = 0; i < logits.size; i += 1) {
    close(logits.grad[i], probs.data[i] - (i === 1 ? 1 : 0));
  }
});

test("embedding and cross entropy validate inputs", () => {
  const table = Tensor.matrix([[1, 2], [3, 4]]);
  assert.throws(() => embedding(table, [2]), /valid vocabulary/);
  assert.throws(() => crossEntropy(Tensor.vector([1, 2]), 4), /valid class/);
});
