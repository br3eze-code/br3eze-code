import test from 'node:test';
import assert from 'node:assert/strict';
import { BigramLanguageModel, buildVocabulary, encodePairs, softmax } from './model.js';

test('softmax is stable and sums to one', () => {
  const p = softmax([10000, 10001, 9999]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-10);
  assert.ok(p.every((x) => Number.isFinite(x) && x > 0));
});

test('vocabulary and pairs encode next-character targets', () => {
  const vocab = buildVocabulary('aba');
  assert.deepEqual(encodePairs('aba', vocab), [[0, 1], [1, 0]]);
});

test('training reduces loss on a repeated corpus', () => {
  const text = 'abababababababababababab';
  const vocab = buildVocabulary(text);
  const pairs = encodePairs(text, vocab);
  const model = new BigramLanguageModel(vocab, { seed: 7 });
  const before = model.lossAndGradient(pairs).loss;
  for (let i = 0; i < 200; i++) model.trainStep(pairs, 0.2);
  const after = model.lossAndGradient(pairs).loss;
  assert.ok(after < before, `expected loss to decrease: ${before} -> ${after}`);
});

test('checkpoint round trip preserves probabilities', () => {
  const model = new BigramLanguageModel(['a', 'b'], { seed: 1 });
  const restored = BigramLanguageModel.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
  assert.deepEqual(restored.probabilities(0), model.probabilities(0));
});

test('invalid checkpoint and invalid training inputs fail clearly', () => {
  assert.throws(() => BigramLanguageModel.fromJSON({}), /Unsupported checkpoint/);
  const model = new BigramLanguageModel(['a', 'b']);
  assert.throws(() => model.trainStep([[0, 1]], 0), /learningRate/);
});
