/**
 * Depth-first model sizing, inspired by nanochat's single complexity dial.
 * This is a small CPU-friendly profile for the Float64 reference model, not
 * a claim of compute-optimal hyperparameters.
 */
export function deriveTransformerConfig({ depth, vocabSize, contextSize = 16, seed = 42 } = {}) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 8) {
    throw new RangeError("depth must be an integer from 1 to 8 for the CPU reference profile");
  }
  if (!Number.isInteger(vocabSize) || vocabSize < 2) {
    throw new RangeError("vocabSize must be an integer >= 2");
  }
  if (!Number.isInteger(contextSize) || contextSize < 2 || contextSize > 256) {
    throw new RangeError("contextSize must be an integer from 2 to 256");
  }
  // Keep head width at four features for this educational profile and cap width
  // at 32 so the one-dial preset remains tractable on a CPU.
  const width = Math.min(32, Math.max(4, depth * 4));
  return {
    vocabSize,
    contextSize,
    width,
    heads: Math.max(1, width / 4),
    layers: depth,
    hiddenSize: width * 4,
    seed
  };
}
