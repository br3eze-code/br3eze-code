#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { TransformerLM } from "./general-transformer.js";

const corpus = "ab".repeat(160) + "ab".repeat(40);
const vocabulary = [...new Set(corpus)].sort();
const ids = [...corpus].map(char => vocabulary.indexOf(char));
const split = Math.floor(ids.length * 0.8);
const train = ids.slice(0, split);
const heldOut = ids.slice(split);
const config = { contextSize: 4, width: 4, heads: 2, layers: 1, hiddenSize: 8, seed: 17 };
const model = new TransformerLM(vocabulary.length, config);

function batches(source, contextSize) {
  const result = [];
  for (let i = 0; i + contextSize < source.length; i += contextSize) {
    result.push({ x: source.slice(i, i + contextSize), y: source.slice(i + 1, i + contextSize + 1) });
  }
  return result;
}
const trainBatches = batches(train, config.contextSize);
const heldOutBatches = batches(heldOut, config.contextSize);
assert.ok(trainBatches.length >= 10 && heldOutBatches.length >= 5, "need enough train and held-out batches");

function meanLoss(targetModel, data) {
  return data.reduce((sum, b) => sum + targetModel.loss(b.x, b.y).value, 0) / data.length;
}
const initialTrainLoss = meanLoss(model, trainBatches);
const initialHeldOutLoss = meanLoss(model, heldOutBatches);
for (let step = 0; step < 100; step++) {
  const batch = trainBatches[step % trainBatches.length];
  model.trainStep(batch.x, batch.y, { learningRate: 0.01, weightDecay: 0, maxGradientNorm: 1 });
}
const finalTrainLoss = meanLoss(model, trainBatches);
const finalHeldOutLoss = meanLoss(model, heldOutBatches);
assert.ok(finalTrainLoss < initialTrainLoss * 0.9, `training loss did not improve enough: ${initialTrainLoss} -> ${finalTrainLoss}`);
assert.ok(finalHeldOutLoss < initialHeldOutLoss * 0.95, `held-out loss did not improve enough: ${initialHeldOutLoss} -> ${finalHeldOutLoss}`);

const checkpointPath = resolve(process.argv[2] ?? "/tmp/br3eze-transformer-verified-checkpoint.json");
await mkdir(dirname(checkpointPath), { recursive: true });
const checkpoint = { format: "br3eze-transformer-training-v1", vocabulary, model: model.toJSON() };
await writeFile(checkpointPath, JSON.stringify(checkpoint), "utf8");
const loaded = JSON.parse(await (await import("node:fs/promises")).readFile(checkpointPath, "utf8"));
assert.deepEqual(loaded.vocabulary, vocabulary, "checkpoint vocabulary round trip");
const restored = TransformerLM.fromJSON(loaded.model);
for (const batch of heldOutBatches.slice(0, 3)) {
  const before = model.loss(batch.x, batch.y).value;
  const after = restored.loss(batch.x, batch.y).value;
  assert.ok(Math.abs(before - after) < 1e-12, `checkpoint changed loss: ${before} vs ${after}`);
}
assert.equal(restored.optimizerStep, model.optimizerStep, "optimizer step round trip");
assert.deepEqual(restored.toJSON().adamM, model.toJSON().adamM, "Adam first moment round trip");
assert.deepEqual(restored.toJSON().adamV, model.toJSON().adamV, "Adam second moment round trip");

const report = {
  status: "passed",
  task: "deterministic next-token learning on alternating-character corpus",
  seed: config.seed,
  config,
  trainExamples: trainBatches.length,
  heldOutExamples: heldOutBatches.length,
  steps: model.optimizerStep,
  initialTrainLoss,
  finalTrainLoss,
  trainLossReductionPercent: 100 * (initialTrainLoss - finalTrainLoss) / initialTrainLoss,
  initialHeldOutLoss,
  finalHeldOutLoss,
  heldOutLossReductionPercent: 100 * (initialHeldOutLoss - finalHeldOutLoss) / initialHeldOutLoss,
  checkpointRoundTrip: "passed (loss, vocabulary, optimizer step and Adam state)",
  checkpointPath
};
console.log(JSON.stringify(report, null, 2));
