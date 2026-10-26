import { multiHeadCausalAttention } from "./multihead.js";
import { layerNorm, linear } from "./layers.js";

/**
 * Pre-norm, single-head decoder block:
 * x + attention(LN(x)), then residual + MLP(LN(...)).
 * This is a learning block, not a production-ready GPT implementation.
 */
export function decoderBlock(x, parameters) {
  const required = [
    "ln1Gamma", "ln1Beta", "qWeight", "qBias", "kWeight", "kBias", "vWeight", "vBias",
    "attentionWeight", "attentionBias", "ln2Gamma", "ln2Beta", "ff1Weight", "ff1Bias", "ff2Weight", "ff2Bias"
  ];
  if (!parameters || required.some((key) => !parameters[key])) {
    throw new TypeError(`decoderBlock requires parameters: ${required.join(", ")}`);
  }
  const normalizedForAttention = layerNorm(x, parameters.ln1Gamma, parameters.ln1Beta);
  const query = linear(normalizedForAttention, parameters.qWeight, parameters.qBias);
  const key = linear(normalizedForAttention, parameters.kWeight, parameters.kBias);
  const value = linear(normalizedForAttention, parameters.vWeight, parameters.vBias);
  const { output: context } = multiHeadCausalAttention(query, key, value, parameters.numHeads ?? 1);
  const attentionOutput = linear(context, parameters.attentionWeight, parameters.attentionBias);
  const afterAttention = x.add(attentionOutput);

  const normalizedForMlp = layerNorm(afterAttention, parameters.ln2Gamma, parameters.ln2Beta);
  const hidden = linear(normalizedForMlp, parameters.ff1Weight, parameters.ff1Bias).relu();
  const feedForwardOutput = linear(hidden, parameters.ff2Weight, parameters.ff2Bias);
  return afterAttention.add(feedForwardOutput);
}
