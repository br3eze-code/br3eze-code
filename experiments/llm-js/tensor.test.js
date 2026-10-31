import test from "node:test";
import assert from "node:assert/strict";
import { Tensor } from "./tensor.js";

const close = (actual, expected, epsilon = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ≈ ${expected}`);
};

test("scalar arithmetic builds a correct reverse-mode gradient", () => {
  const x = Tensor.scalar(3);
  const loss = x.mul(x).add(x.mul(2)).sum();
  loss.backward();
  close(loss.value, 15);
  close(x.grad[0], 8);
});

test("scalar broadcasting accumulates the scalar gradient", () => {
  const x = Tensor.vector([1, 2, 3]);
  const scale = Tensor.scalar(4);
  x.mul(scale).sum().backward();
  assert.deepEqual(Array.from(x.grad), [4, 4, 4]);
  close(scale.grad[0], 6);
});

test("matrix multiplication computes values and both gradients", () => {
  const a = Tensor.matrix([[1, 2], [3, 4]]);
  const b = Tensor.matrix([[5], [6]]);
  const y = a.matmul(b);
  assert.deepEqual(y.toArray(), [[17], [39]]);
  y.sum().backward();
  assert.deepEqual(Array.from(a.grad), [5, 6, 5, 6]);
  assert.deepEqual(Array.from(b.grad), [4, 6]);
});

test("relu, exp, log and sum compose into a differentiable graph", () => {
  const x = Tensor.vector([-2, 0, 2]);
  const loss = x.relu().exp().log().sum();
  loss.backward();
  close(loss.value, 2);
  assert.deepEqual(Array.from(x.grad), [0, 0, 1]);
});

test("shared subgraphs accumulate gradients from every use", () => {
  const x = Tensor.scalar(2);
  const y = x.mul(x);
  y.add(y).backward();
  close(x.grad[0], 8);
});

test("rejects incompatible matrix dimensions and accidental non-scalar backward", () => {
  assert.throws(() => Tensor.matrix([[1, 2]]).matmul(Tensor.matrix([[1, 2]])), /inner dimensions/);
  assert.throws(() => Tensor.vector([1, 2]).backward(), /scalar result/);
});
