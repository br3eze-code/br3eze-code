import test from "node:test";
import assert from "node:assert/strict";
import { TinyGPT } from "./gpt.js";

test("TinyGPT returns one vocabulary-logit row per input token", () => {
  const model = new TinyGPT(5, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, seed: 7 });
  const logits = model.forward([0, 1, 2]);
  assert.deepEqual(logits.shape, [3, 5]);
  assert.ok(logits.data.every(Number.isFinite));
});

test("TinyGPT trains through the decoder block and reduces a repeated example loss", () => {
  const model = new TinyGPT(4, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, seed: 3 });
  const input = [0, 1, 2];
  const target = [1, 2, 3];
  const initial = model.loss(input, target).value;
  for (let step = 0; step < 20; step += 1) model.trainStep(input, target, 0.03);
  const final = model.loss(input, target).value;
  assert.ok(Number.isFinite(final));
  assert.ok(final < initial, `expected loss to decrease from ${initial} to ${final}`);
});

test("TinyGPT generation is deterministic for a fixed seed", () => {
  const model = new TinyGPT(5, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, seed: 9 });
  const a = model.generate([0], { maxNewTokens: 8, seed: 123 });
  const b = model.generate([0], { maxNewTokens: 8, seed: 123 });
  assert.deepEqual(a, b);
});

test("TinyGPT checkpoint round trip preserves logits", () => {
  const model = new TinyGPT(5, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, seed: 11 });
  model.trainStep([0, 1, 2], [1, 2, 3], 0.01);
  const expected = model.forward([0, 1, 2]).toArray();
  const restored = TinyGPT.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
  assert.deepEqual(restored.forward([0, 1, 2]).toArray(), expected);
  model.trainStep([0, 1, 2], [1, 2, 3], 0.01);
  restored.trainStep([0, 1, 2], [1, 2, 3], 0.01);
  assert.deepEqual(restored.forward([0, 1, 2]).toArray(), model.forward([0, 1, 2]).toArray());
});

test("TinyGPT validates context and checkpoint formats", () => {
  const model = new TinyGPT(3, { contextSize: 2, embeddingSize: 2, hiddenSize: 4 });
  assert.throws(() => model.forward([0, 1, 2]), /contextSize/);
  assert.throws(() => TinyGPT.fromJSON({}), /checkpoint format/);
});

test("TinyGPT supports multi-head attention and preserves head count in checkpoints", () => {
  const model = new TinyGPT(5, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, numHeads: 2, seed: 17 });
  const expected = model.forward([0, 1, 2]).toArray();
  const restored = TinyGPT.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
  assert.equal(restored.numHeads, 2);
  assert.deepEqual(restored.forward([0, 1, 2]).toArray(), expected);
});

test("TinyGPT rejects head counts that do not divide embedding width", () => {
  assert.throws(() => new TinyGPT(5, { embeddingSize: 3, numHeads: 2 }), /evenly divide/);
});

test("TinyGPT supports stacked decoder blocks and round-trips depth", () => {
  const model = new TinyGPT(5, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, numHeads: 2, numLayers: 2, seed: 21 });
  const expected = model.forward([0, 1, 2]).toArray();
  const restored = TinyGPT.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
  assert.equal(restored.numLayers, 2);
  assert.deepEqual(restored.forward([0, 1, 2]).toArray(), expected);
  model.trainStep([0, 1, 2], [1, 2, 3], 0.01);
  assert.ok(model.params.block1_qWeight.data.every(Number.isFinite));
});

test("TinyGPT rejects unreasonable decoder depth", () => {
  assert.throws(() => new TinyGPT(5, { numLayers: 13 }), /from 1 to 12/);
});
