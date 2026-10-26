import { Tensor } from "./tensor.js";

/** Add a feature-width bias vector to each row of a rank-2 tensor. */
export function addRowVector(matrix, vector) {
  if (!(matrix instanceof Tensor) || matrix.shape.length !== 2 || !(vector instanceof Tensor) || vector.shape.length !== 1) {
    throw new TypeError("addRowVector expects a matrix and a vector");
  }
  const [rows, cols] = matrix.shape;
  if (vector.shape[0] !== cols) throw new RangeError("bias width must match matrix columns");
  const out = new Tensor(new Float64Array(matrix.size), matrix.shape);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) out.data[row * cols + col] = matrix.data[row * cols + col] + vector.data[col];
  }
  out.parents = [matrix, vector];
  out._backward = () => {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const g = out.grad[row * cols + col];
        matrix.grad[row * cols + col] += g;
        vector.grad[col] += g;
      }
    }
  };
  return out;
}

/** Fully connected transform: x [sequence,in] @ weight [in,out] + bias [out]. */
export function linear(x, weight, bias) {
  if (!(x instanceof Tensor) || x.shape.length !== 2 || !(weight instanceof Tensor) || weight.shape.length !== 2) {
    throw new TypeError("linear expects matrix input and matrix weights");
  }
  if (x.shape[1] !== weight.shape[0]) throw new RangeError("linear input width must match weight rows");
  if (!(bias instanceof Tensor) || bias.shape.length !== 1 || bias.shape[0] !== weight.shape[1]) {
    throw new RangeError("linear bias width must match output width");
  }
  return addRowVector(x.matmul(weight), bias);
}

/** Per-token layer normalization over each row's feature dimension. */
export function layerNorm(x, gamma, beta, epsilon = 1e-5) {
  if (!(x instanceof Tensor) || x.shape.length !== 2 || !(gamma instanceof Tensor) || gamma.shape.length !== 1 || !(beta instanceof Tensor) || beta.shape.length !== 1) {
    throw new TypeError("layerNorm expects a matrix input and scale/shift vectors");
  }
  const [rows, cols] = x.shape;
  if (gamma.shape[0] !== cols || beta.shape[0] !== cols) throw new RangeError("layerNorm parameter widths must match input");
  if (!(epsilon > 0) || !Number.isFinite(epsilon)) throw new RangeError("epsilon must be a positive finite number");
  const means = new Float64Array(rows);
  const inverseStd = new Float64Array(rows);
  const normalized = new Float64Array(x.size);
  const out = new Tensor(new Float64Array(x.size), x.shape);
  for (let row = 0; row < rows; row += 1) {
    let mean = 0;
    for (let col = 0; col < cols; col += 1) mean += x.data[row * cols + col];
    mean /= cols;
    means[row] = mean;
    let variance = 0;
    for (let col = 0; col < cols; col += 1) {
      const delta = x.data[row * cols + col] - mean;
      variance += delta * delta;
    }
    variance /= cols;
    inverseStd[row] = 1 / Math.sqrt(variance + epsilon);
    for (let col = 0; col < cols; col += 1) {
      const i = row * cols + col;
      normalized[i] = (x.data[i] - mean) * inverseStd[row];
      out.data[i] = normalized[i] * gamma.data[col] + beta.data[col];
    }
  }
  out.parents = [x, gamma, beta];
  out._backward = () => {
    for (let row = 0; row < rows; row += 1) {
      let sumGradient = 0;
      let sumGradientTimesNormalized = 0;
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const scaledGradient = out.grad[i] * gamma.data[col];
        sumGradient += scaledGradient;
        sumGradientTimesNormalized += scaledGradient * normalized[i];
        gamma.grad[col] += out.grad[i] * normalized[i];
        beta.grad[col] += out.grad[i];
      }
      for (let col = 0; col < cols; col += 1) {
        const i = row * cols + col;
        const scaledGradient = out.grad[i] * gamma.data[col];
        x.grad[i] += inverseStd[row] / cols *
          (cols * scaledGradient - sumGradient - normalized[i] * sumGradientTimesNormalized);
      }
    }
  };
  return out;
}
