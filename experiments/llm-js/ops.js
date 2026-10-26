import { Tensor } from "./tensor.js";

/**
 * Look up token embeddings from a [vocabulary, embeddingSize] weight matrix.
 * Repeated token IDs correctly accumulate gradients into the same embedding row.
 */
export function embedding(weight, tokenIds) {
  if (!(weight instanceof Tensor) || weight.shape.length !== 2) {
    throw new TypeError("embedding weight must be a rank-2 Tensor");
  }
  if (!Array.isArray(tokenIds) || tokenIds.some((id) => !Number.isInteger(id) || id < 0 || id >= weight.shape[0])) {
    throw new RangeError("token IDs must be valid vocabulary indices");
  }
  const [vocabSize, width] = weight.shape;
  const out = new Tensor(tokenIds.flatMap((id) => Array.from(weight.data.slice(id * width, (id + 1) * width))), [tokenIds.length, width]);
  out.parents = [weight];
  out._backward = () => {
    tokenIds.forEach((id, row) => {
      for (let col = 0; col < width; col += 1) {
        weight.grad[id * width + col] += out.grad[row * width + col];
      }
    });
  };
  // Empty sequences cannot form a valid tensor under the current shape contract.
  return out;
}

/** Numerically stable softmax for a rank-1 logits vector. */
export function softmax(logits) {
  if (!(logits instanceof Tensor) || logits.shape.length !== 1) {
    throw new TypeError("softmax expects a rank-1 Tensor");
  }
  const max = Math.max(...logits.data);
  const exps = logits.data.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  const probabilities = exps.map((value) => value / total);
  const out = new Tensor(probabilities, logits.shape);
  out.parents = [logits];
  out._backward = () => {
    // Jacobian-vector product: p_i * (g_i - sum_j(g_j * p_j)).
    let weightedGradient = 0;
    for (let i = 0; i < probabilities.length; i += 1) weightedGradient += out.grad[i] * probabilities[i];
    for (let i = 0; i < probabilities.length; i += 1) {
      logits.grad[i] += probabilities[i] * (out.grad[i] - weightedGradient);
    }
  };
  return out;
}

/**
 * Stable single-example cross entropy from raw class logits.
 * The target is an integer class index; gradient is softmax(logits) - oneHot(target).
 */
export function crossEntropy(logits, targetIndex) {
  if (!(logits instanceof Tensor) || logits.shape.length !== 1) {
    throw new TypeError("crossEntropy expects a rank-1 logits Tensor");
  }
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= logits.size) {
    throw new RangeError("targetIndex must be a valid class index");
  }
  const max = Math.max(...logits.data);
  const exps = logits.data.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  const probabilities = exps.map((value) => value / total);
  const loss = Tensor.scalar(Math.log(total) + max - logits.data[targetIndex]);
  loss.parents = [logits];
  loss._backward = () => {
    for (let i = 0; i < logits.size; i += 1) {
      logits.grad[i] += loss.grad[0] * (probabilities[i] - (i === targetIndex ? 1 : 0));
    }
  };
  return loss;
}
