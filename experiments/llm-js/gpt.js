import { Tensor } from "./tensor.js";
import { embedding, row, crossEntropy, softmax } from "./ops.js";
import { linear, layerNorm } from "./layers.js";
import { decoderBlock } from "./transformer.js";
import { AdamW } from "./optimizer.js";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function zeros(length) {
  return Tensor.vector(new Array(length).fill(0));
}

function matrix(rows, cols, rng, scale) {
  return new Tensor(Array.from({ length: rows * cols }, () => (rng() * 2 - 1) * scale), [rows, cols]);
}

const BLOCK_PARAMETER_NAMES = [
  "ln1Gamma", "ln1Beta", "qWeight", "qBias", "kWeight", "kBias", "vWeight", "vBias",
  "attentionWeight", "attentionBias", "ln2Gamma", "ln2Beta", "ff1Weight", "ff1Bias", "ff2Weight", "ff2Bias"
];

/**
 * Tiny decoder-only character model for educational CPU training.
 * Supports configurable decoder depth and causal attention heads.
 */
export class TinyGPT {
  constructor(vocabSize, {
    contextSize = 32,
    embeddingSize = 16,
    hiddenSize = embeddingSize * 4,
    numHeads = 1,
    numLayers = 1,
    seed = 42
  } = {}) {
    if (!Number.isInteger(vocabSize) || vocabSize < 2) throw new RangeError("vocabSize must be an integer >= 2");
    for (const [name, value] of [["contextSize", contextSize], ["embeddingSize", embeddingSize], ["hiddenSize", hiddenSize]]) {
      if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
    }
    if (!Number.isInteger(numHeads) || numHeads < 1 || embeddingSize % numHeads !== 0) {
      throw new RangeError("numHeads must evenly divide embeddingSize");
    }
    if (!Number.isInteger(numLayers) || numLayers < 1 || numLayers > 12) {
      throw new RangeError("numLayers must be an integer from 1 to 12");
    }
    this.vocabSize = vocabSize;
    this.contextSize = contextSize;
    this.embeddingSize = embeddingSize;
    this.hiddenSize = hiddenSize;
    this.numHeads = numHeads;
    this.numLayers = numLayers;
    this.seed = seed;

    const rng = seededRandom(seed);
    const d = embeddingSize;
    const h = hiddenSize;
    const init = (rows, cols) => matrix(rows, cols, rng, Math.sqrt(6 / (rows + cols)));
    const normScale = () => Tensor.vector(new Array(d).fill(1));
    const normShift = () => zeros(d);
    this.params = {
      tokenEmbedding: matrix(vocabSize, d, rng, 0.04),
      positionEmbedding: matrix(contextSize, d, rng, 0.04),
      finalGamma: normScale(),
      finalBeta: normShift(),
      lmHeadWeight: init(d, vocabSize),
      lmHeadBias: zeros(vocabSize)
    };
    for (let layer = 0; layer < numLayers; layer += 1) {
      const prefix = `block${layer}_`;
      Object.assign(this.params, {
        [prefix + "ln1Gamma"]: normScale(),
        [prefix + "ln1Beta"]: normShift(),
        [prefix + "qWeight"]: init(d, d),
        [prefix + "qBias"]: zeros(d),
        [prefix + "kWeight"]: init(d, d),
        [prefix + "kBias"]: zeros(d),
        [prefix + "vWeight"]: init(d, d),
        [prefix + "vBias"]: zeros(d),
        [prefix + "attentionWeight"]: init(d, d),
        [prefix + "attentionBias"]: zeros(d),
        [prefix + "ln2Gamma"]: normScale(),
        [prefix + "ln2Beta"]: normShift(),
        [prefix + "ff1Weight"]: init(d, h),
        [prefix + "ff1Bias"]: zeros(h),
        [prefix + "ff2Weight"]: init(h, d),
        [prefix + "ff2Bias"]: zeros(d)
      });
    }
    this.parameterList = Object.values(this.params);
    this.optimizer = new AdamW();
  }

  getBlockParameters(layer) {
    if (!Number.isInteger(layer) || layer < 0 || layer >= this.numLayers) throw new RangeError("layer index is out of range");
    const prefix = `block${layer}_`;
    return Object.fromEntries(BLOCK_PARAMETER_NAMES.map((name) => [name, this.params[prefix + name]]));
  }

  forward(tokenIds) {
    if (!Array.isArray(tokenIds) || tokenIds.length < 1 || tokenIds.length > this.contextSize) {
      throw new RangeError(`tokenIds must contain 1..${this.contextSize} token IDs (contextSize limit)`);
    }
    const positions = tokenIds.map((_token, index) => index);
    const tokenVectors = embedding(this.params.tokenEmbedding, tokenIds);
    const positionVectors = embedding(this.params.positionEmbedding, positions);
    let decoded = tokenVectors.add(positionVectors);
    for (let layer = 0; layer < this.numLayers; layer += 1) {
      decoded = decoderBlock(decoded, { ...this.getBlockParameters(layer), numHeads: this.numHeads });
    }
    const normalized = layerNorm(decoded, this.params.finalGamma, this.params.finalBeta);
    return linear(normalized, this.params.lmHeadWeight, this.params.lmHeadBias);
  }

  loss(inputIds, targetIds) {
    if (!Array.isArray(inputIds) || !Array.isArray(targetIds) || inputIds.length !== targetIds.length || inputIds.length === 0) {
      throw new RangeError("inputIds and targetIds must be non-empty arrays of equal length");
    }
    if (inputIds.length > this.contextSize) throw new RangeError("training sequence exceeds contextSize");
    const logits = this.forward(inputIds);
    let total = null;
    for (let i = 0; i < targetIds.length; i += 1) {
      const tokenLoss = crossEntropy(row(logits, i), targetIds[i]);
      total = total === null ? tokenLoss : total.add(tokenLoss);
    }
    return total.mul(1 / targetIds.length);
  }

  trainStep(inputIds, targetIds, learningRate = 0.01, maxGradientNorm = 1) {
    if (!(learningRate > 0) || !Number.isFinite(learningRate)) throw new RangeError("learningRate must be positive and finite");
    if (!(maxGradientNorm > 0) || !Number.isFinite(maxGradientNorm)) throw new RangeError("maxGradientNorm must be positive and finite");
    for (const parameter of this.parameterList) parameter.zeroGrad();
    const loss = this.loss(inputIds, targetIds);
    loss.backward();
    let squaredNorm = 0;
    for (const parameter of this.parameterList) {
      for (const gradient of parameter.grad) squaredNorm += gradient * gradient;
    }
    const norm = Math.sqrt(squaredNorm);
    const scale = norm > maxGradientNorm ? maxGradientNorm / (norm || 1) : 1;
    this.optimizer.step(this.parameterList, learningRate, { gradientScale: scale });
    return loss.value;
  }

  generate(seedIds, { maxNewTokens = 100, temperature = 1, seed = this.seed } = {}) {
    if (!Array.isArray(seedIds) || seedIds.length === 0 || seedIds.some((id) => !Number.isInteger(id) || id < 0 || id >= this.vocabSize)) {
      throw new RangeError("seedIds must be a non-empty list of valid token IDs");
    }
    if (!Number.isInteger(maxNewTokens) || maxNewTokens < 0) throw new RangeError("maxNewTokens must be a non-negative integer");
    if (!(temperature > 0) || !Number.isFinite(temperature)) throw new RangeError("temperature must be positive and finite");
    const rng = seededRandom(seed);
    const result = [...seedIds];
    for (let step = 0; step < maxNewTokens; step += 1) {
      const context = result.slice(-this.contextSize);
      const logits = row(this.forward(context), context.length - 1);
      const probabilities = softmax(logits.mul(1 / temperature)).data;
      let draw = rng();
      let selected = probabilities.length - 1;
      for (let i = 0; i < probabilities.length; i += 1) {
        draw -= probabilities[i];
        if (draw <= 0) { selected = i; break; }
      }
      result.push(selected);
    }
    return result;
  }

  toJSON() {
    return {
      format: "br3eze-llm-js-tiny-gpt-v1",
      vocabSize: this.vocabSize,
      contextSize: this.contextSize,
      embeddingSize: this.embeddingSize,
      hiddenSize: this.hiddenSize,
      numHeads: this.numHeads,
      numLayers: this.numLayers,
      seed: this.seed,
      optimizer: this.optimizer.toJSON(this.parameterList),
      parameters: Object.fromEntries(Object.entries(this.params).map(([name, tensor]) => [name, {
        shape: tensor.shape,
        data: Array.from(tensor.data)
      }]))
    };
  }

  static fromJSON(checkpoint) {
    if (!checkpoint || checkpoint.format !== "br3eze-llm-js-tiny-gpt-v1" || !checkpoint.parameters) {
      throw new TypeError("invalid TinyGPT checkpoint format");
    }
    const model = new TinyGPT(checkpoint.vocabSize, checkpoint);
    for (const [name, tensor] of Object.entries(model.params)) {
      const saved = checkpoint.parameters[name];
      if (!saved || JSON.stringify(saved.shape) !== JSON.stringify(tensor.shape) || !Array.isArray(saved.data) || saved.data.length !== tensor.size) {
        throw new RangeError(`checkpoint parameter mismatch: ${name}`);
      }
      if (saved.data.some((value) => !Number.isFinite(value))) throw new RangeError(`checkpoint contains non-finite values: ${name}`);
      tensor.data.set(saved.data);
    }
    if (checkpoint.optimizer) model.optimizer.restoreState(model.parameterList, checkpoint.optimizer);
    return model;
  }
}
