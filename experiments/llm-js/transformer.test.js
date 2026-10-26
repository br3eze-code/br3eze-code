import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";
import { decoderBlock } from "./transformer.js";

const matrix = (rows) => Tensor.matrix(rows);
const vector = (values) => Tensor.vector(values);

function tinyParameters() {
  return {
    ln1Gamma: vector([1, 1]), ln1Beta: vector([0, 0]),
    qWeight: matrix([[1, 0], [0, 1]]), qBias: vector([0, 0]),
    kWeight: matrix([[1, 0], [0, 1]]), kBias: vector([0, 0]),
    vWeight: matrix([[1, 0], [0, 1]]), vBias: vector([0, 0]),
    attentionWeight: matrix([[1, 0], [0, 1]]), attentionBias: vector([0, 0]),
    ln2Gamma: vector([1, 1]), ln2Beta: vector([0, 0]),
    ff1Weight: matrix([[0.5, -0.2, 0.1], [0.3, 0.4, -0.5]]), ff1Bias: vector([0, 0, 0]),
    ff2Weight: matrix([[0.2, 0.1], [0.4, -0.3], [-0.2, 0.5]]), ff2Bias: vector([0, 0])
  };
}

test("single-head decoder block preserves shape and backpropagates", () => {
  const x = matrix([[1, 0], [0, 1], [1, 1]]);
  const params = tinyParameters();
  const output = decoderBlock(x, params);
  assert.deepEqual(output.shape, [3, 2]);
  assert.ok(output.data.every(Number.isFinite));
  output.mul(output).sum().backward();
  assert.ok(x.grad.every(Number.isFinite));
  for (const value of Object.values(params)) assert.ok(value.grad.every(Number.isFinite));
});

test("decoder block rejects missing parameters", () => {
  assert.throws(() => decoderBlock(matrix([[1, 2]]), {}), /requires parameters/);
});
