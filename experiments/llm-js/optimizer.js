/**
 * AdamW optimizer for the tiny Tensor engine.
 * Keeps optimizer state outside model parameters; checkpointing optimizer state is a later milestone.
 */
export class AdamW {
  constructor({ beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8, weightDecay = 0.01 } = {}) {
    if (!(beta1 >= 0 && beta1 < 1) || !(beta2 >= 0 && beta2 < 1) ||
        !(epsilon > 0) || !Number.isFinite(epsilon) ||
        !(weightDecay >= 0) || !Number.isFinite(weightDecay)) {
      throw new RangeError("invalid AdamW hyperparameters");
    }
    this.beta1 = beta1;
    this.beta2 = beta2;
    this.epsilon = epsilon;
    this.weightDecay = weightDecay;
    this.stepCount = 0;
    this.states = new WeakMap();
  }

  step(parameters, learningRate, { gradientScale = 1 } = {}) {
    if (!Array.isArray(parameters) || parameters.some((p) => !p || !(p.data instanceof Float64Array) || !(p.grad instanceof Float64Array))) {
      throw new TypeError("AdamW expects a list of trainable Tensor parameters");
    }
    if (!(learningRate > 0) || !Number.isFinite(learningRate)) throw new RangeError("learningRate must be positive and finite");
    if (!(gradientScale > 0) || !Number.isFinite(gradientScale)) throw new RangeError("gradientScale must be positive and finite");
    this.stepCount += 1;
    const correction1 = 1 - this.beta1 ** this.stepCount;
    const correction2 = 1 - this.beta2 ** this.stepCount;

    for (const parameter of parameters) {
      let state = this.states.get(parameter);
      if (!state || state.m.length !== parameter.size) {
        state = { m: new Float64Array(parameter.size), v: new Float64Array(parameter.size) };
        this.states.set(parameter, state);
      }
      const decay = parameter.shape.length === 2 ? this.weightDecay : 0;
      for (let i = 0; i < parameter.size; i += 1) {
        const gradient = parameter.grad[i] * gradientScale;
        state.m[i] = this.beta1 * state.m[i] + (1 - this.beta1) * gradient;
        state.v[i] = this.beta2 * state.v[i] + (1 - this.beta2) * gradient * gradient;
        const mHat = state.m[i] / correction1;
        const vHat = state.v[i] / correction2;
        parameter.data[i] -= learningRate * (mHat / (Math.sqrt(vHat) + this.epsilon) + decay * parameter.data[i]);
      }
    }
  }
}
