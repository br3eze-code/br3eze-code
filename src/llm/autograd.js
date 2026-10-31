/**
 * Small scalar reverse-mode automatic differentiation engine.
 *
 * Educational reference implementation inspired by the principles behind
 * Karpathy's micrograd/microgpt. It intentionally favors readable code over
 * tensor-level performance. It is not a production numerical backend.
 */
export class Value {
  constructor(data, children = [], backward = () => {}, label = '') {
    if (!Number.isFinite(data)) {
      throw new TypeError('Value data must be a finite number');
    }
    this.data = data;
    this.grad = 0;
    this._prev = new Set(children);
    this._backward = backward;
    this.label = label;
  }

  static of(value) {
    return value instanceof Value ? value : new Value(value);
  }

  add(other) {
    const rhs = Value.of(other);
    const out = new Value(this.data + rhs.data, [this, rhs], () => {
      this.grad += out.grad;
      rhs.grad += out.grad;
    });
    return out;
  }

  sub(other) {
    return this.add(Value.of(other).neg());
  }

  mul(other) {
    const rhs = Value.of(other);
    const out = new Value(this.data * rhs.data, [this, rhs], () => {
      this.grad += rhs.data * out.grad;
      rhs.grad += this.data * out.grad;
    });
    return out;
  }

  div(other) {
    const rhs = Value.of(other);
    if (rhs.data === 0) throw new RangeError('Division by zero');
    return this.mul(rhs.pow(-1));
  }

  pow(exponent) {
    if (!Number.isFinite(exponent)) throw new TypeError('Exponent must be finite');
    if (this.data < 0 && !Number.isInteger(exponent)) {
      throw new RangeError('Fractional powers of negative values are not real');
    }
    if (this.data === 0 && exponent < 0) throw new RangeError('Zero cannot have a negative power');
    const out = new Value(this.data ** exponent, [this], () => {
      this.grad += exponent * (this.data ** (exponent - 1)) * out.grad;
    });
    return out;
  }

  neg() {
    return this.mul(-1);
  }

  relu() {
    const out = new Value(Math.max(0, this.data), [this], () => {
      this.grad += (this.data > 0 ? 1 : 0) * out.grad;
    });
    return out;
  }

  tanh() {
    const result = Math.tanh(this.data);
    const out = new Value(result, [this], () => {
      this.grad += (1 - result * result) * out.grad;
    });
    return out;
  }

  exp() {
    const result = Math.exp(this.data);
    if (!Number.isFinite(result)) throw new RangeError('exp overflowed');
    const out = new Value(result, [this], () => {
      this.grad += result * out.grad;
    });
    return out;
  }

  log() {
    if (this.data <= 0) throw new RangeError('log requires a positive value');
    const out = new Value(Math.log(this.data), [this], () => {
      this.grad += (1 / this.data) * out.grad;
    });
    return out;
  }

  backward() {
    const topology = [];
    const visited = new Set();
    const visit = (node) => {
      if (visited.has(node)) return;
      visited.add(node);
      for (const parent of node._prev) visit(parent);
      topology.push(node);
    };

    visit(this);
    this.grad += 1;
    for (let index = topology.length - 1; index >= 0; index -= 1) {
      topology[index]._backward();
    }
  }

  zeroGrad() {
    this.grad = 0;
  }

  toString() {
    return `Value(data=${this.data}, grad=${this.grad}${this.label ? `, label=${this.label}` : ''})`;
  }
}

export function value(data, label = '') {
  return new Value(data, [], undefined, label);
}

export function sum(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('sum expects a non-empty array');
  }
  return values.reduce((total, item) => total.add(item), Value.of(0));
}

export function softmax(logits) {
  if (!Array.isArray(logits) || logits.length === 0) {
    throw new TypeError('softmax expects a non-empty array');
  }
  const max = Math.max(...logits.map((item) => Value.of(item).data));
  const exponentials = logits.map((item) => Value.of(item).sub(max).exp());
  const denominator = sum(exponentials);
  return exponentials.map((item) => item.div(denominator));
}
