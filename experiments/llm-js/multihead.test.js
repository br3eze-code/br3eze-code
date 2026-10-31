import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";
import { multiHeadCausalAttention } from "./multihead.js";

test("multi-head attention concatenates head contexts and backpropagates", () => {
  const query = Tensor.matrix([[1, 0, 1, 0], [0, 1, 0, 1], [1, 1, 1, 1]]);
  const key = Tensor.matrix([[1, 0, 1, 0], [0, 1, 0, 1], [1, 1, 1, 1]]);
  const value = Tensor.matrix([[10, 20, 1, 2], [30, 40, 3, 4], [50, 60, 5, 6]]);
  const { output, attentionWeights } = multiHeadCausalAttention(query, key, value, 2);
  assert.deepEqual(output.shape, [3, 4]);
  assert.equal(attentionWeights.length, 2);
  assert.deepEqual(attentionWeights[0].toArray()[0], [1, 0, 0]);
  assert.deepEqual(attentionWeights[1].toArray()[0], [1, 0, 0]);
  output.mul(output).sum().backward();
  for (const tensor of [query, key, value]) assert.ok(tensor.grad.every(Number.isFinite));
});

test("multi-head attention rejects non-divisible widths", () => {
  const q = Tensor.matrix([[1, 2, 3]]);
  assert.throws(() => multiHeadCausalAttention(q, q, q, 2), /evenly divides/);
});
