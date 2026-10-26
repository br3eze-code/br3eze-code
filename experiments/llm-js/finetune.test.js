import test from "node:test";
import assert from "node:assert/strict";
import { TinyGPT } from "./gpt.js";
import { importWeights } from "./import.js";
import { configureTrainableParameters } from "./finetune.js";

function fixture() {
  const model = new TinyGPT(5, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, numHeads: 2, numLayers: 2, seed: 12 });
  return { ...model.toJSON(), tokenizer: { type: "character", vocabulary: ["a", "b", "c", "d", "e"] } };
}

test("strict import copies checkpoint weights and rejects shape mismatches", () => {
  const checkpoint = fixture();
  const model = new TinyGPT(5, checkpoint);
  const result = importWeights(model, checkpoint);
  assert.equal(result.imported.length, Object.keys(model.params).length);
  assert.deepEqual(Array.from(model.params.lmHeadWeight.data), checkpoint.parameters.lmHeadWeight.data);
  const wrong = structuredClone(checkpoint);
  wrong.parameters.lmHeadWeight.shape = [5, 5];
  assert.throws(() => importWeights(model, wrong), /shape mismatch/);
});

test("import transposes compatible rank-2 state dictionary weights", () => {
  const model = new TinyGPT(3, { contextSize: 2, embeddingSize: 2, hiddenSize: 4, seed: 4 });
  const original = Array.from(model.params.lmHeadWeight.data);
  const [rows, cols] = model.params.lmHeadWeight.shape;
  const transposed = Array.from({ length: rows * cols }, (_, i) => original[(i % rows) * cols + Math.floor(i / rows)]);
  const result = importWeights(model, { state_dict: { lmHeadWeight: { shape: [cols, rows], data: transposed } } }, { strict: false });
  assert.ok(result.imported.some((item) => item.target === "lmHeadWeight"));
  assert.deepEqual(Array.from(model.params.lmHeadWeight.data), original);
});

test("head-only fine-tuning updates the head and leaves frozen gradients zero", () => {
  const model = new TinyGPT(4, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, seed: 5 });
  const policy = configureTrainableParameters(model, { unfreezeHeadOnly: true });
  const embeddingBefore = Array.from(model.params.tokenEmbedding.data);
  const headBefore = Array.from(model.params.lmHeadWeight.data);
  model.trainStep([0, 1, 2], [1, 2, 3], 0.02);
  assert.deepEqual(Array.from(model.params.tokenEmbedding.data), embeddingBefore);
  assert.notDeepEqual(Array.from(model.params.lmHeadWeight.data), headBefore);
  assert.ok(model.params.lmHeadWeight.grad.some((value) => value !== 0));
  assert.ok(model.frozenParameters.every((parameter) => parameter.grad.every((value) => value === 0)));
  assert.equal(policy.trainable.length, 2);
  assert.equal(model.optimizer.toJSON(model.trainableParameters).states.length, 2);
});

test("freeze-base policy keeps embeddings and decoder weights unchanged", () => {
  const model = new TinyGPT(4, { contextSize: 4, embeddingSize: 4, hiddenSize: 8, seed: 6 });
  configureTrainableParameters(model, { freezeBase: true });
  const blockBefore = Array.from(model.params.block0_qWeight.data);
  const headBefore = Array.from(model.params.lmHeadWeight.data);
  model.trainStep([0, 1, 2], [1, 2, 3], 0.01);
  assert.deepEqual(Array.from(model.params.block0_qWeight.data), blockBefore);
  assert.notDeepEqual(Array.from(model.params.lmHeadWeight.data), headBefore);
  assert.ok(model.frozenParameters.every((parameter) => parameter.grad.every((value) => value === 0)));
});

test("loaded checkpoint completes five fine-tuning steps with decreasing repeated-example loss", () => {
  const checkpoint = fixture();
  const model = TinyGPT.fromJSON(checkpoint);
  importWeights(model, checkpoint);
  configureTrainableParameters(model, { unfreezeHeadOnly: true });
  const input = [0, 1, 2], target = [1, 2, 3];
  const initial = model.loss(input, target).value;
  for (let step = 0; step < 5; step += 1) model.trainStep(input, target, 0.02);
  const final = model.loss(input, target).value;
  assert.ok(Number.isFinite(final));
  assert.ok(final < initial, `expected loss to decrease from ${initial} to ${final}`);
  assert.equal(model.optimizer.stepCount, 5);
});
