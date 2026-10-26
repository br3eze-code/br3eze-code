/**
 * Tiny Float64 tensor + reverse-mode autodiff engine for educational training.
 * Supported shapes: scalars, vectors, and rank-2 matrices. No broadcasting beyond scalars.
 * This is a correctness-first reference implementation, not a fast numerical backend.
 */
export class Tensor {
  constructor(data, shape = []) {
    if (!Array.isArray(shape) || shape.some((n) => !Number.isInteger(n) || n < 1)) {
      throw new TypeError("shape must contain positive integers");
    }
    const values = data instanceof Float64Array ? new Float64Array(data) : Float64Array.from(data);
    const size = shape.reduce((n, d) => n * d, 1);
    if (values.length !== size) {
      throw new RangeError(`data length ${values.length} does not match shape size ${size}`);
    }
    if (![0, 1, 2].includes(shape.length)) {
      throw new RangeError("only scalar, vector, and matrix tensors are supported");
    }
    this.data = values;
    this.shape = [...shape];
    this.grad = new Float64Array(size);
    this.parents = [];
    this._backward = () => {};
  }

  static scalar(value) {
    return new Tensor([value]);
  }

  static vector(values) {
    return new Tensor(values, [values.length]);
  }

  static matrix(rows) {
    if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(rows[0]) || rows[0].length === 0) {
      throw new TypeError("matrix requires non-empty rows");
    }
    const width = rows[0].length;
    if (rows.some((row) => !Array.isArray(row) || row.length !== width)) {
      throw new RangeError("matrix rows must have equal lengths");
    }
    return new Tensor(rows.flat(), [rows.length, width]);
  }

  get size() {
    return this.data.length;
  }

  get value() {
    if (this.shape.length !== 0) throw new TypeError("value is only available on scalar tensors");
    return this.data[0];
  }

  _binary(other, operation) {
    const rhs = other instanceof Tensor ? other : Tensor.scalar(other);
    const leftScalar = this.shape.length === 0;
    const rightScalar = rhs.shape.length === 0;
    if (!leftScalar && !rightScalar && (this.shape.length !== rhs.shape.length || this.shape.some((d, i) => d !== rhs.shape[i]))) {
      throw new RangeError("tensor shapes must match unless one operand is scalar");
    }
    const shape = leftScalar ? rhs.shape : this.shape;
    const size = shape.reduce((n, d) => n * d, 1);
    const out = new Tensor(Array.from({ length: size }, (_, i) => {
      const a = this.data[leftScalar ? 0 : i];
      const b = rhs.data[rightScalar ? 0 : i];
      return operation.forward(a, b);
    }), shape);
    out.parents = [this, rhs];
    out._backward = () => {
      for (let i = 0; i < size; i += 1) {
        const ai = leftScalar ? 0 : i;
        const bi = rightScalar ? 0 : i;
        const a = this.data[ai];
        const b = rhs.data[bi];
        const g = out.grad[i];
        this.grad[ai] += operation.left(a, b, g);
        rhs.grad[bi] += operation.right(a, b, g);
      }
    };
    return out;
  }

  add(other) {
    return this._binary(other, { forward: (a, b) => a + b, left: (_a, _b, g) => g, right: (_a, _b, g) => g });
  }

  mul(other) {
    return this._binary(other, { forward: (a, b) => a * b, left: (_a, b, g) => b * g, right: (a, _b, g) => a * g });
  }

  matmul(other) {
    if (!(other instanceof Tensor) || this.shape.length !== 2 || other.shape.length !== 2) {
      throw new TypeError("matmul expects two rank-2 tensors");
    }
    const [m, k] = this.shape;
    const [k2, n] = other.shape;
    if (k !== k2) throw new RangeError("matmul inner dimensions must match");
    const out = new Tensor(new Float64Array(m * n), [m, n]);
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < n; j += 1) {
        for (let p = 0; p < k; p += 1) out.data[i * n + j] += this.data[i * k + p] * other.data[p * n + j];
      }
    }
    out.parents = [this, other];
    out._backward = () => {
      for (let i = 0; i < m; i += 1) {
        for (let j = 0; j < n; j += 1) {
          const g = out.grad[i * n + j];
          for (let p = 0; p < k; p += 1) {
            this.grad[i * k + p] += g * other.data[p * n + j];
            other.grad[p * n + j] += this.data[i * k + p] * g;
          }
        }
      }
    };
    return out;
  }

  transpose() {
    if (this.shape.length !== 2) throw new TypeError("transpose expects a rank-2 Tensor");
    const [rows, cols] = this.shape;
    const out = new Tensor(new Float64Array(this.size), [cols, rows]);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) out.data[c * rows + r] = this.data[r * cols + c];
    }
    out.parents = [this];
    out._backward = () => {
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) this.grad[r * cols + c] += out.grad[c * rows + r];
      }
    };
    return out;
  }

  softmaxRows() {
    if (this.shape.length !== 2) throw new TypeError("softmaxRows expects a rank-2 Tensor");
    const [rows, cols] = this.shape;
    const out = new Tensor(new Float64Array(this.size), this.shape);
    for (let r = 0; r < rows; r += 1) {
      let max = -Infinity;
      for (let c = 0; c < cols; c += 1) max = Math.max(max, this.data[r * cols + c]);
      let total = 0;
      for (let c = 0; c < cols; c += 1) {
        const value = Math.exp(this.data[r * cols + c] - max);
        out.data[r * cols + c] = value;
        total += value;
      }
      for (let c = 0; c < cols; c += 1) out.data[r * cols + c] /= total;
    }
    out.parents = [this];
    out._backward = () => {
      for (let r = 0; r < rows; r += 1) {
        let weightedGradient = 0;
        for (let c = 0; c < cols; c += 1) {
          const i = r * cols + c;
          weightedGradient += out.grad[i] * out.data[i];
        }
        for (let c = 0; c < cols; c += 1) {
          const i = r * cols + c;
          this.grad[i] += out.data[i] * (out.grad[i] - weightedGradient);
        }
      }
    };
    return out;
  }

  relu() {
    const out = new Tensor(this.data.map((x) => Math.max(0, x)), this.shape);
    out.parents = [this];
    out._backward = () => {
      for (let i = 0; i < this.size; i += 1) if (this.data[i] > 0) this.grad[i] += out.grad[i];
    };
    return out;
  }

  exp() {
    const out = new Tensor(this.data.map(Math.exp), this.shape);
    out.parents = [this];
    out._backward = () => {
      for (let i = 0; i < this.size; i += 1) this.grad[i] += out.grad[i] * out.data[i];
    };
    return out;
  }

  log() {
    const out = new Tensor(this.data.map(Math.log), this.shape);
    out.parents = [this];
    out._backward = () => {
      for (let i = 0; i < this.size; i += 1) this.grad[i] += out.grad[i] / this.data[i];
    };
    return out;
  }

  sum() {
    let total = 0;
    for (const x of this.data) total += x;
    const out = Tensor.scalar(total);
    out.parents = [this];
    out._backward = () => {
      for (let i = 0; i < this.size; i += 1) this.grad[i] += out.grad[0];
    };
    return out;
  }

  zeroGrad() {
    this.grad.fill(0);
    return this;
  }

  backward(seed = 1) {
    if (this.shape.length !== 0 && !(seed instanceof Float64Array)) {
      throw new TypeError("backward() requires a scalar result or an explicit Float64Array seed");
    }
    const topo = [];
    const seen = new Set();
    const visit = (node) => {
      if (seen.has(node)) return;
      seen.add(node);
      for (const parent of node.parents) visit(parent);
      topo.push(node);
    };
    visit(this);
    if (seed instanceof Float64Array) {
      if (seed.length !== this.size) throw new RangeError("gradient seed length must match tensor size");
      this.grad.set(seed);
    } else {
      this.grad[0] = seed;
    }
    for (let i = topo.length - 1; i >= 0; i -= 1) topo[i]._backward();
    return this;
  }

  toArray() {
    if (this.shape.length === 2) {
      const [rows, cols] = this.shape;
      return Array.from({ length: rows }, (_, r) => Array.from(this.data.slice(r * cols, (r + 1) * cols)));
    }
    return this.shape.length === 0 ? this.data[0] : Array.from(this.data);
  }
}
