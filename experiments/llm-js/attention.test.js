import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";
import { causalMask, causalSelfAttention } from "./attention.js";

const close = (actual, expected, epsilon = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`);
};

test("transpose reverses shape and propagates gradients back to original positions", () => {
  const x = Tensor.matrix([[1, 2, 3], [4, 5, 6]]);
  const transposed = x.transpose();
  assert.deepEqual(transposed.toArray(), [[1, 4], [2, 5], [3, 6]]);
  transposed.sum().backward();
  assert.deepEqual(Array.from(x.grad), [1, 1, 1, 1, 1, 1]);
});

test("row-wise softmax normalizes each row and backpropagates finite gradients", () => {
  const x = Tensor.matrix([[1000, 1001], [-1000, -999]]);
  const p = x.softmaxRows();
  const values = p.toArray();
  close(values[0][0] + values[0][1], 1);
  close(values[1][0] + values[1][1], 1);
  p.mul(p).sum().backward();
  assert.ok(x.grad.every(Number.isFinite));
});

test("causal mask prevents future-token attention", () => {
  const scores = Tensor.matrix([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
  const masked = causalMask(scores);
  const probabilities = masked.softmaxRows();
  const rows = probabilities.toArray();
  assert.deepEqual(rows[0], [1, 0, 0]);
  close(rows[1][2], 0);
  close(rows[1][0] + rows[1][1], 1);
  close(rows[2].reduce((sum, value) => sum + value, 0), 1);
});

test("causal self-attention produces a context tensor and supports backward", () => {
  const q = Tensor.matrix([[1, 0], [0, 1], [1, 1]]);
  const k = Tensor.matrix([[1, 0], [0, 1], [1, 1]]);
  const v = Tensor.matrix([[10, 0], [0, 10], [5, 5]]);
  const { output, attentionWeights } = causalSelfAttention(q, k, v);
  assert.deepEqual(output.shape, [3, 2]);
  assert.deepEqual(attentionWeights.toArray()[0], [1, 0, 0]);
  assert.equal(attentionWeights.toArray()[0][1], 0);
  output.sum().backward();
  for (const tensor of [q, k, v]) assert.ok(tensor.grad.every(Number.isFinite));
});

test("causal attention validates incompatible shapes", () => {
  assert.throws(
    () => causalSelfAttention(Tensor.matrix([[1, 2]]), Tensor.matrix([[1, 2], [3, 4]]), Tensor.matrix([[1, 2]])),
    /dimensions are incompatible/
  );
});
