import { Tensor } from "./tensor.js";

/** Replace future-token attention scores with -Infinity while blocking their gradients. */
export function causalMask(scores) {
  if (!(scores instanceof Tensor) || scores.shape.length !== 2 || scores.shape[0] !== scores.shape[1]) {
    throw new TypeError("causalMask expects a square rank-2 score matrix");
  }
  const size = scores.shape[0];
  const out = new Tensor(new Float64Array(scores.data), scores.shape);
  for (let row = 0; row < size; row += 1) {
    for (let col = row + 1; col < size; col += 1) out.data[row * size + col] = -Infinity;
  }
  out.parents = [scores];
  out._backward = () => {
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col <= row; col += 1) {
        const i = row * size + col;
        scores.grad[i] += out.grad[i];
      }
    }
  };
  return out;
}

/**
 * Single-head causal scaled dot-product self-attention.
 * query/key/value are [sequenceLength, featureWidth] tensors.
 * Returns both the context tensor and attention weights for inspection.
 */
export function causalSelfAttention(query, key, value) {
  for (const [name, tensor] of [["query", query], ["key", key], ["value", value]]) {
    if (!(tensor instanceof Tensor) || tensor.shape.length !== 2) {
      throw new TypeError(`${name} must be a rank-2 Tensor`);
    }
  }
  const [sequenceLength, queryWidth] = query.shape;
  if (key.shape[0] !== sequenceLength || value.shape[0] !== sequenceLength || key.shape[1] !== queryWidth) {
    throw new RangeError("query, key and value dimensions are incompatible");
  }
  const scores = query.matmul(key.transpose()).mul(1 / Math.sqrt(queryWidth));
  const attentionWeights = causalMask(scores).softmaxRows();
  return { output: attentionWeights.matmul(value), attentionWeights };
}
