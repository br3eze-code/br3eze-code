import { Tensor } from "./tensor.js";

/**
 * Look up token embeddings from a [vocabulary, embeddingSize] weight matrix.
 * Repeated token IDs correctly accumulate gradients into the same embedding row.
 */
export function embedding(weight, tokenIds) {
  if (!(weight instanceof Tensor) || weight.shape.length !== 2) {
    throw new TypeError("embedding weight must be a rank-2 Tensor");
  }
  if (!Array.isArray(tokenIds) || tokenIds.length === 0 || tokenIds.some((id) => !Number.isInteger(id) || id < 0 || id >= weight.shape[0])) {
    throw new RangeError("token IDs must be a non-empty list of valid vocabulary indices");
  }
  const width = weight.shape[1];
  const out = new Tensor(tokenIds.flatMap((id) => Array.from(weight.data.slice(id * width, (id + 1) * width))), [tokenIds.length, width]);
  out.parents = [weight];
  out._backward = () => {
    tokenIds.forEach((id, row) => {
      for (let col = 0; col < width; col += 1) {
        weight.grad[id * width + col] += out.grad[row * width + col];
      }
    });
  };
  return out;
}

/** Select one row from a matrix while preserving gradient flow. */
export function row(matrix, rowIndex) {
  if (!(matrix instanceof Tensor) || matrix.shape.length !== 2) throw new TypeError("row expects a rank-2 Tensor");
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= matrix.shape[0]) throw new RangeError("rowIndex is out of range");
  const width = matrix.shape[1];
  const out = new Tensor(matrix.data.slice(rowIndex * width, (rowIndex + 1) * width), [width]);
  out.parents = [matrix];
  out._backward = () => {
    for (let col = 0; col < width; col += 1) matrix.grad[rowIndex * width + col] += out.grad[col];
  };
  return out;
}

/** Slice a contiguous feature range from a matrix, preserving gradients. */
export function sliceColumns(matrix, start, end) {
  if (!(matrix instanceof Tensor) || matrix.shape.length !== 2) throw new TypeError("sliceColumns expects a rank-2 Tensor");
  const [rows, cols] = matrix.shape;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > cols) {
    throw new RangeError("column slice must be a non-empty in-bounds range");
  }
  const width = end - start;
  const data = new Float64Array(rows * width);
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    data.set(matrix.data.slice(rowIndex * cols + start, rowIndex * cols + end), rowIndex * width);
  }
  const out = new Tensor(data, [rows, width]);
  out.parents = [matrix];
  out._backward = () => {
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      for (let col = 0; col < width; col += 1) matrix.grad[rowIndex * cols + start + col] += out.grad[rowIndex * width + col];
    }
  };
  return out;
}

/** Concatenate equal-row-count matrices by feature columns, preserving gradients. */
export function concatColumns(matrices) {
  if (!Array.isArray(matrices) || matrices.length === 0 || matrices.some((item) => !(item instanceof Tensor) || item.shape.length !== 2)) {
    throw new TypeError("concatColumns expects a non-empty list of matrices");
  }
  const rows = matrices[0].shape[0];
  if (matrices.some((item) => item.shape[0] !== rows)) throw new RangeError("all matrices must have the same row count");
  const widths = matrices.map((item) => item.shape[1]);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const out = new Tensor(new Float64Array(rows * totalWidth), [rows, totalWidth]);
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    let offset = rowIndex * totalWidth;
    matrices.forEach((item, index) => {
      out.data.set(item.data.slice(rowIndex * widths[index], (rowIndex + 1) * widths[index]), offset);
      offset += widths[index];
    });
  }
  out.parents = matrices;
  out._backward = () => {
    for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
      let offset = rowIndex * totalWidth;
      matrices.forEach((item, index) => {
        for (let col = 0; col < widths[index]; col += 1) item.grad[rowIndex * widths[index] + col] += out.grad[offset + col];
        offset += widths[index];
      });
    }
  };
  return out;
}

/** Numerically stable softmax for a rank-1 logits vector. */
export function softmax(logits) {
  if (!(logits instanceof Tensor) || logits.shape.length !== 1) {
    throw new TypeError("softmax expects a rank-1 Tensor");
  }
  let max = -Infinity;
  for (const value of logits.data) max = Math.max(max, value);
  const exps = logits.data.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  const probabilities = exps.map((value) => value / total);
  const out = new Tensor(probabilities, logits.shape);
  out.parents = [logits];
  out._backward = () => {
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
  let max = -Infinity;
  for (const value of logits.data) max = Math.max(max, value);
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
