import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";
import { addRowVector, layerNorm, linear } from "./layers.js";

test("linear layer propagates gradients into input, weights and shared bias", () => {
  const x = Tensor.matrix([[1, 2], [3, 4]]);
  const weight = Tensor.matrix([[1, 0], [0, 1]]);
  const bias = Tensor.vector([0.5, -0.5]);
  const y = linear(x, weight, bias);
  assert.deepEqual(y.toArray(), [[1.5, 1.5], [3.5, 3.5]]);
  y.sum().backward();
  assert.deepEqual(Array.from(x.grad), [1, 1, 1, 1]);
  assert.deepEqual(Array.from(weight.grad), [4, 4, 6, 6]);
  assert.deepEqual(Array.from(bias.grad), [2, 2]);
});

test("row bias sums gradients across rows", () => {
  const x = Tensor.matrix([[1, 2], [3, 4]]);
  const bias = Tensor.vector([10, 20]);
  addRowVector(x, bias).sum().backward();
  assert.deepEqual(Array.from(bias.grad), [2, 2]);
});

test("layer normalization produces normalized features and finite gradients", () => {
  const x = Tensor.matrix([[1, 3], [2, 6]]);
  const gamma = Tensor.vector([1, 1]);
  const beta = Tensor.vector([0, 0]);
  const y = layerNorm(x, gamma, beta);
  const values = y.toArray();
  assert.ok(values[0][0] < 0 && values[0][1] > 0);
  assert.ok(values[1][0] < 0 && values[1][1] > 0);
  y.mul(y).sum().backward();
  for (const tensor of [x, gamma, beta]) assert.ok(tensor.grad.every(Number.isFinite));
});

test("layer normalization validates parameter dimensions", () => {
  assert.throws(() => layerNorm(Tensor.matrix([[1, 2]]), Tensor.vector([1]), Tensor.vector([0])), /widths must match/);
});
