import { causalSelfAttention } from "./attention.js";
import { concatColumns, sliceColumns } from "./ops.js";
import { Tensor } from "./tensor.js";

/**
 * Multi-head causal attention over projected [sequence, embeddingWidth] query/key/value matrices.
 * Each head receives a disjoint contiguous feature slice; output heads are concatenated.
 */
export function multiHeadCausalAttention(query, key, value, numHeads = 1) {
  for (const [name, tensor] of [["query", query], ["key", key], ["value", value]]) {
    if (!(tensor instanceof Tensor) || tensor.shape.length !== 2) throw new TypeError(`${name} must be a rank-2 Tensor`);
  }
  const [sequenceLength, width] = query.shape;
  if (key.shape[0] !== sequenceLength || value.shape[0] !== sequenceLength ||
      key.shape[1] !== width || value.shape[1] !== width) {
    throw new RangeError("query, key and value dimensions must match");
  }
  if (!Number.isInteger(numHeads) || numHeads < 1 || width % numHeads !== 0) {
    throw new RangeError("numHeads must be a positive integer that evenly divides the feature width");
  }
  const headWidth = width / numHeads;
  const outputs = [];
  const weights = [];
  for (let head = 0; head < numHeads; head += 1) {
    const start = head * headWidth;
    const end = start + headWidth;
    const result = causalSelfAttention(
      sliceColumns(query, start, end),
      sliceColumns(key, start, end),
      sliceColumns(value, start, end)
    );
    outputs.push(result.output);
    weights.push(result.attentionWeights);
  }
  return { output: concatColumns(outputs), attentionWeights: weights };
}
