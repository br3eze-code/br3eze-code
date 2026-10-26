import test from "node:test";
import assert from "node:assert/strict";
import { TinyGPT } from "./gpt.js";
import { runFineTuning } from "./finetune-runner.js";

function createModel() {
  return new TinyGPT(5, {
    contextSize: 4,
    embeddingSize: 4,
    hiddenSize: 8,
    numHeads: 2,
    numLayers: 1,
    seed: 17
  });
}

test("runner trains selected head parameters and leaves frozen base weights unchanged", async () => {
  const model = createModel();
  const baseBefore = Array.from(model.params.tokenEmbedding.data);
  const headBefore = Array.from(model.params.lmHeadWeight.data);
  const result = await runFineTuning(model, model.optimizer, [
    { inputs: [0, 1, 2], targets: [1, 2, 3] }
  ], {
    epochs: 2,
    learningRate: 0.02,
    unfreezeHeadOnly: true,
    logger: () => {}
  });

  assert.equal(result.history.length, 2);
  assert.equal(result.trainable.length, 2);
  assert.deepEqual(Array.from(model.params.tokenEmbedding.data), baseBefore);
  assert.notDeepEqual(Array.from(model.params.lmHeadWeight.data), headBefore);
  assert.ok(model.frozenParameters.every((parameter) => parameter.grad.every((value) => value === 0)));
});

test("runner accepts checkpoint objects and rejects empty datasets", async () => {
  const source = createModel();
  const checkpoint = source.toJSON();
  const model = createModel();
  const originalEmbedding = Array.from(source.params.tokenEmbedding.data);
  model.params.tokenEmbedding.data.fill(0);
  await runFineTuning(model, model.optimizer, [
    { inputs: [0, 1], targets: [1, 2] }
  ], { checkpoint, epochs: 1, unfreezeHeadOnly: true, logger: () => {} });
  assert.deepEqual(Array.from(model.params.tokenEmbedding.data), originalEmbedding);

  await assert.rejects(
    runFineTuning(createModel(), createModel().optimizer, [], { epochs: 1, logger: () => {} }),
    /no batches/
  );
});

test("runner validates epoch count and batch shape", async () => {
  const model = createModel();
  await assert.rejects(
    runFineTuning(model, model.optimizer, [{ inputs: [0], targets: [1] }], {
      epochs: 0,
      logger: () => {}
    }),
    /epochs must be/
  );
  await assert.rejects(
    runFineTuning(model, model.optimizer, [{}], { epochs: 1, logger: () => {} }),
    /each batch must contain/
  );
});
