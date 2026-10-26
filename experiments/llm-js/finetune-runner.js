import { loadCheckpoint, importWeights } from "./import.js";
import { configureTrainableParameters } from "./finetune.js";

/**
 * Run fine-tuning against the native TinyGPT/Tensor/AdamW APIs.
 *
 * dataset must be a re-iterable array or a function returning an iterable of
 * { inputs: number[], targets: number[] } batches. A custom optimizer must
 * implement step(parameters, learningRate, { gradientScale }).
 */
export async function runFineTuning(model, optimizer = model?.optimizer, dataset, args = {}) {
  if (!model?.params || !Array.isArray(model.parameterList) || typeof model.loss !== "function") {
    throw new TypeError("model must be a TinyGPT-compatible model");
  }
  if (!optimizer || typeof optimizer.step !== "function") {
    throw new TypeError("optimizer must implement step(parameters, learningRate, options)");
  }
  if (!dataset || !(Array.isArray(dataset) || typeof dataset[Symbol.iterator] === "function" || typeof dataset === "function")) {
    throw new TypeError("dataset must be a re-iterable collection or a function returning an iterable");
  }

  if (args.checkpoint) {
    const checkpoint = typeof args.checkpoint === "string"
      ? await loadCheckpoint(args.checkpoint)
      : args.checkpoint;
    importWeights(model, checkpoint, { strict: true });
  }

  const policy = configureTrainableParameters(model, {
    freezeBase: Boolean(args.freezeBase),
    unfreezeHeadOnly: Boolean(args.unfreezeHeadOnly),
    trainFinalNorm: args.trainFinalNorm !== false
  });
  const trainable = model.trainableParameters;
  const frozen = model.frozenParameters;
  if (trainable.length === 0) throw new Error("fine-tuning policy selected no trainable parameters");

  const epochs = args.epochs ?? 5;
  const learningRate = args.learningRate ?? args.lr ?? 0.001;
  const maxGradientNorm = args.maxGradientNorm ?? 1;
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 100000) {
    throw new RangeError("epochs must be an integer from 1 to 100000");
  }
  if (!(learningRate > 0) || !Number.isFinite(learningRate)) {
    throw new RangeError("learningRate must be positive and finite");
  }
  if (!(maxGradientNorm > 0) || !Number.isFinite(maxGradientNorm)) {
    throw new RangeError("maxGradientNorm must be positive and finite");
  }

  const batchesForEpoch = () => {
    const batches = typeof dataset === "function" ? dataset() : dataset;
    if (!batches || typeof batches[Symbol.iterator] !== "function") {
      throw new TypeError("dataset function must return an iterable of batches");
    }
    return batches;
  };
  const history = [];
  const logger = typeof args.logger === "function" ? args.logger : console.log;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    let totalLoss = 0;
    let steps = 0;
    for (const batch of batchesForEpoch()) {
      if (!batch || !Array.isArray(batch.inputs) || !Array.isArray(batch.targets)) {
        throw new TypeError("each batch must contain inputs and targets arrays");
      }
      for (const parameter of model.parameterList) parameter.zeroGrad();
      const loss = model.loss(batch.inputs, batch.targets);
      loss.backward();

      let squaredNorm = 0;
      for (const parameter of trainable) {
        for (const gradient of parameter.grad) squaredNorm += gradient * gradient;
      }
      if (!Number.isFinite(squaredNorm)) throw new Error("non-finite gradient norm; refusing optimizer update");
      const norm = Math.sqrt(squaredNorm);
      const gradientScale = norm > maxGradientNorm ? maxGradientNorm / (norm || 1) : 1;
      const value = loss.value;
      if (!Number.isFinite(value)) throw new Error("non-finite loss; stopping fine-tuning");
      optimizer.step(trainable, learningRate, { gradientScale });
      for (const parameter of frozen) parameter.zeroGrad();
      totalLoss += value;
      steps += 1;
    }
    if (steps === 0) throw new Error("dataset yielded no batches");
    const averageLoss = totalLoss / steps;
    const result = { epoch: epoch + 1, averageLoss, steps };
    history.push(result);
    logger(`Epoch ${result.epoch} | Average Loss: ${averageLoss.toFixed(4)}`);
  }

  return { history, trainable: [...policy.trainable], frozenCount: policy.frozen };
}
