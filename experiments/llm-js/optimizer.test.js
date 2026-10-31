import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";
import { AdamW } from "./optimizer.js";

test("AdamW updates parameters with finite values and bias-corrected moments", () => {
  const parameter = Tensor.vector([2, -3]);
  parameter.grad.set([0.5, -0.25]);
  const optimizer = new AdamW({ weightDecay: 0 });
  optimizer.step([parameter], 0.01);
  assert.notDeepEqual(Array.from(parameter.data), [2, -3]);
  assert.ok(parameter.data.every(Number.isFinite));
  assert.equal(optimizer.stepCount, 1);
  parameter.grad.set([0.1, 0.2]);
  optimizer.step([parameter], 0.01);
  assert.equal(optimizer.stepCount, 2);
  assert.ok(parameter.data.every(Number.isFinite));
});

test("AdamW applies decoupled decay to matrix weights but not vectors", () => {
  const weight = Tensor.matrix([[2]]);
  const bias = Tensor.vector([2]);
  weight.grad.fill(0);
  bias.grad.fill(0);
  new AdamW({ weightDecay: 0.1 }).step([weight, bias], 0.1);
  assert.ok(weight.data[0] < 2);
  assert.equal(bias.data[0], 2);
});

test("AdamW rejects invalid learning rates", () => {
  assert.throws(() => new AdamW().step([Tensor.vector([1])], 0), /learningRate/);
});
