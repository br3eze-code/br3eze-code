// Original, dependency-free character-level bigram language model.
// Educational baseline for the Node.js training path; not a Transformer.
import { randomBytes } from 'node:crypto';

export function seededRandom(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function softmax(logits) {
  if (!Array.isArray(logits) || logits.length === 0) {
    throw new TypeError('softmax expects a non-empty array');
  }
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

export class BigramLanguageModel {
  constructor(vocab, { seed = 42, weights } = {}) {
    if (!Array.isArray(vocab) || vocab.length < 2) {
      throw new TypeError('vocab must contain at least two tokens');
    }
    this.vocab = [...vocab];
    this.index = new Map(this.vocab.map((token, i) => [token, i]));
    const n = this.vocab.length;
    const rng = seededRandom(seed);
    this.weights = weights
      ? weights.map((row) => [...row])
      : Array.from({ length: n }, () =>
          Array.from({ length: n }, () => (rng() * 2 - 1) * 0.01));
    if (this.weights.length !== n || this.weights.some((row) => row.length !== n)) {
      throw new TypeError('weights shape must be vocabSize x vocabSize');
    }
  }

  probabilities(previousId) {
    if (!Number.isInteger(previousId) || previousId < 0 || previousId >= this.vocab.length) {
      throw new RangeError('previous token id is outside vocabulary');
    }
    return softmax(this.weights[previousId]);
  }

  lossAndGradient(pairs) {
    if (!Array.isArray(pairs) || pairs.length === 0) {
      throw new TypeError('pairs must be a non-empty array');
    }
    const n = this.vocab.length;
    const gradient = Array.from({ length: n }, () => Array(n).fill(0));
    let loss = 0;
    for (const [previousId, targetId] of pairs) {
      const probs = this.probabilities(previousId);
      loss -= Math.log(Math.max(probs[targetId], 1e-12));
      for (let j = 0; j < n; j++) {
        gradient[previousId][j] += probs[j] - (j === targetId ? 1 : 0);
      }
    }
    const scale = 1 / pairs.length;
    for (const row of gradient) for (let j = 0; j < n; j++) row[j] *= scale;
    return { loss: loss * scale, gradient };
  }

  trainStep(pairs, learningRate = 0.1) {
    if (!(learningRate > 0) || !Number.isFinite(learningRate)) {
      throw new RangeError('learningRate must be a positive finite number');
    }
    const result = this.lossAndGradient(pairs);
    for (let i = 0; i < this.weights.length; i++) {
      for (let j = 0; j < this.weights.length; j++) {
        this.weights[i][j] -= learningRate * result.gradient[i][j];
      }
    }
    return result.loss;
  }

  generate({ length = 100, seed = 42, startToken = '\n' } = {}) {
    if (!Number.isInteger(length) || length < 0) throw new RangeError('length must be >= 0');
    const rng = seededRandom(seed);
    let current = this.index.has(startToken) ? this.index.get(startToken) : 0;
    let output = this.vocab[current];
    for (let i = 0; i < length; i++) {
      const probs = this.probabilities(current);
      let sample = rng();
      let next = probs.length - 1;
      for (let j = 0; j < probs.length; j++) {
        sample -= probs[j];
        if (sample <= 0) { next = j; break; }
      }
      output += this.vocab[next];
      current = next;
    }
    return output;
  }

  toJSON() {
    return { format: 'br3eze-llm-js-bigram-v1', vocab: this.vocab, weights: this.weights };
  }

  static fromJSON(data) {
    if (data?.format !== 'br3eze-llm-js-bigram-v1') throw new TypeError('Unsupported checkpoint format');
    return new BigramLanguageModel(data.vocab, { weights: data.weights });
  }
}

export function encodePairs(text, vocab) {
  const index = new Map(vocab.map((token, i) => [token, i]));
  const ids = [...text].map((char) => index.get(char));
  if (ids.some((id) => id === undefined)) throw new Error('Text contains tokens outside vocabulary');
  return ids.slice(0, -1).map((id, i) => [id, ids[i + 1]]);
}

export function buildVocabulary(text) {
  const chars = [...new Set([...text])].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  if (chars.length < 2) throw new Error('Training text must contain at least two distinct characters');
  return chars;
}
