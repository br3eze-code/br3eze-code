import test from "node:test";
import assert from "node:assert/strict";
import { deriveTransformerConfig } from "./model-config.js";

test("depth dial derives valid progressively wider/deeper model configs", () => {
  const small = deriveTransformerConfig({ depth: 1, vocabSize: 20 });
  const large = deriveTransformerConfig({ depth: 6, vocabSize: 20, contextSize: 32, seed: 7 });
  assert.equal(small.layers, 1);
  assert.equal(small.width, 4);
  assert.equal(small.heads, 1);
  assert.equal(small.hiddenSize, 16);
  assert.equal(large.layers, 6);
  assert.equal(large.width, 24);
  assert.equal(large.heads, 6);
  assert.equal(large.hiddenSize, 96);
  assert.equal(large.contextSize, 32);
  assert.equal(large.seed, 7);
  assert.equal(large.width % large.heads, 0);
});

test("depth dial rejects invalid sizes before model allocation", () => {
  assert.throws(() => deriveTransformerConfig({ depth: 0, vocabSize: 10 }), /depth/);
  assert.throws(() => deriveTransformerConfig({ depth: 9, vocabSize: 10 }), /depth/);
  assert.throws(() => deriveTransformerConfig({ depth: 2, vocabSize: 1 }), /vocabSize/);
  assert.throws(() => deriveTransformerConfig({ depth: 2, vocabSize: 10, contextSize: 1 }), /contextSize/);
});
