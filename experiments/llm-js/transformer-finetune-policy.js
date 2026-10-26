/**
 * Fine-tuning policy for the native Float64 TransformerLM.
 * Frozen parameters still participate in forward/backpropagation where needed,
 * but are excluded from optimizer updates and have their exposed gradients cleared.
 */
export function configureTransformerTrainableParameters(model, {
  freezeBase = false,
  unfreezeHeadOnly = false,
  trainFinalNorm = true
} = {}) {
  if (!model || !Array.isArray(model.parameters) || !Array.isArray(model.parameterNames)) {
    throw new TypeError("expected a TransformerLM with named parameters");
  }
  if (freezeBase && unfreezeHeadOnly) {
    throw new Error("--freeze-base and --unfreeze-head-only are mutually exclusive");
  }
  const allowed = unfreezeHeadOnly
    ? new Set(["lmW", "lmB"])
    : freezeBase
      ? new Set(["lmW", "lmB", ...(trainFinalNorm ? ["finalNorm.gamma", "finalNorm.beta"] : [])])
      : null;
  const trainable = model.parameterNames
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !allowed || allowed.has(name) || [...allowed].some(prefix => name.startsWith(prefix + ".")));
  if (!trainable.length) throw new Error("fine-tuning policy selected no trainable parameters");
  const active = new Set(trainable.map(({ index }) => index));
  model.trainableParameterIndices = [...active];
  model.frozenParameterIndices = model.parameters.map((_, index) => index).filter(index => !active.has(index));
  // Fine-tuning begins with fresh Adam moments rather than carrying pretraining momentum.
  model.adamM = model.parameters.map(parameter => new Float64Array(parameter.size));
  model.adamV = model.parameters.map(parameter => new Float64Array(parameter.size));
  model.optimizerStep = 0;
  return {
    trainable: trainable.map(({ name }) => name),
    trainableCount: trainable.length,
    frozenCount: model.frozenParameterIndices.length
  };
}
