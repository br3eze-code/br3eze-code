#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TinyGPT } from "./gpt.js";
import { AdamW } from "./optimizer.js";
import { seededRandom } from "./model.js";
import { importWeights } from "./import.js";

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
}
function numberOption(args, name, fallback) {
  const value = Number(option(args, name, String(fallback)));
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${name}`);
  return value;
}

/** Frozen tensors remain in the graph for correct input-gradient propagation,
 * but are excluded from AdamW and have their exposed gradients cleared. */
export function configureTrainableParameters(model, {
  freezeBase = false, unfreezeHeadOnly = false, trainFinalNorm = true
} = {}) {
  if (freezeBase && unfreezeHeadOnly) throw new Error("--freeze-base and --unfreeze-head-only are mutually exclusive");
  const entries = Object.entries(model.params);
  const active = unfreezeHeadOnly
    ? entries.filter(([name]) => name === "lmHeadWeight" || name === "lmHeadBias")
    : freezeBase
      ? entries.filter(([name]) => name === "lmHeadWeight" || name === "lmHeadBias" ||
          (trainFinalNorm && (name === "finalGamma" || name === "finalBeta")))
      : entries;
  // Fine-tuning starts a fresh optimizer: pretraining moments are not reused.
  // AdamW creates moment buffers lazily only for the active parameters passed to step().
  const previousOptimizer = model.optimizer;
  model.optimizer = new AdamW({
    beta1: previousOptimizer?.beta1 ?? 0.9,
    beta2: previousOptimizer?.beta2 ?? 0.999,
    epsilon: previousOptimizer?.epsilon ?? 1e-8,
    weightDecay: previousOptimizer?.weightDecay ?? 0.01
  });
  model.trainableParameterNames = new Set(active.map(([name]) => name));
  model.trainableParameters = active.map(([, tensor]) => tensor);
  model.frozenParameters = entries.filter(([name]) => !model.trainableParameterNames.has(name)).map(([, tensor]) => tensor);
  model.trainStep = function trainableStep(inputIds, targetIds, learningRate = 0.001, maxGradientNorm = 1) {
    if (!(learningRate > 0) || !Number.isFinite(learningRate)) throw new RangeError("learningRate must be positive and finite");
    if (!(maxGradientNorm > 0) || !Number.isFinite(maxGradientNorm)) throw new RangeError("maxGradientNorm must be positive and finite");
    for (const parameter of this.parameterList) parameter.zeroGrad();
    const loss = this.loss(inputIds, targetIds);
    loss.backward();
    let squaredNorm = 0;
    for (const parameter of this.trainableParameters) {
      for (const gradient of parameter.grad) squaredNorm += gradient * gradient;
    }
    const norm = Math.sqrt(squaredNorm);
    const scale = norm > maxGradientNorm ? maxGradientNorm / (norm || 1) : 1;
    this.optimizer.step(this.trainableParameters, learningRate, { gradientScale: scale });
    for (const parameter of this.frozenParameters) parameter.zeroGrad();
    return loss.value;
  };
  return { trainable: [...model.trainableParameterNames], frozen: model.frozenParameters.length };
}

export async function finetuneCli(args = process.argv.slice(2)) {
  const checkpointPath = option(args, "--checkpoint");
  const inputPath = option(args, "--input");
  if (!checkpointPath) throw new Error("--checkpoint is required and must point to a compatible TinyGPT JSON checkpoint");
  if (!inputPath) throw new Error("--input is required and must point to a UTF-8 text corpus");
  const [checkpoint, text] = await Promise.all([
    readFile(resolve(checkpointPath), "utf8").then(JSON.parse),
    readFile(resolve(inputPath), "utf8")
  ]);
  const vocabulary = checkpoint.tokenizer?.vocabulary;
  if (checkpoint.tokenizer?.type !== "character" || !Array.isArray(vocabulary)) {
    throw new Error("Base checkpoint must include tokenizer.type=character and tokenizer.vocabulary");
  }
  const vocabularySet = new Set(vocabulary);
  const unknown = [...new Set([...text].filter((char) => !vocabularySet.has(char)))];
  if (unknown.length) throw new Error(`Corpus has ${unknown.length} character(s) missing from checkpoint vocabulary. Expand/retrain tokenizer before fine-tuning.`);
  const config = checkpoint.config ?? checkpoint;
  const isNativeCheckpoint = checkpoint.format === "br3eze-llm-js-tiny-gpt-v1";
  const model = isNativeCheckpoint
    ? TinyGPT.fromJSON(checkpoint)
    : new TinyGPT(
      config.vocabSize ?? config.vocab_size ?? vocabulary.length,
      {
        contextSize: config.contextSize ?? config.n_positions ?? config.max_position_embeddings ?? 32,
        embeddingSize: config.embeddingSize ?? config.n_embd ?? config.hidden_size ?? 16,
        hiddenSize: config.hiddenSize ?? config.n_inner ?? (config.n_embd ?? config.hidden_size ?? 16) * 4,
        numHeads: config.numHeads ?? config.n_head ?? config.num_attention_heads ?? 1,
        numLayers: config.numLayers ?? config.n_layer ?? config.num_hidden_layers ?? 1,
        seed: config.seed ?? 42
      }
    );
  if (model.vocabSize !== vocabulary.length) throw new Error("Checkpoint vocabulary size does not match tokenizer vocabulary");
  importWeights(model, checkpoint, { strict: true });
  const policy = configureTrainableParameters(model, {
    freezeBase: args.includes("--freeze-base"),
    unfreezeHeadOnly: args.includes("--unfreeze-head-only")
  });
  const tokenIds = [...text].map((char) => vocabulary.indexOf(char));
  if (tokenIds.length < 4) throw new Error("Training input must contain at least 4 characters");
  const split = Math.min(tokenIds.length - 2, Math.max(2, Math.floor(tokenIds.length * 0.9)));
  const trainIds = tokenIds.slice(0, split);
  const sequenceLength = Math.min(model.contextSize, trainIds.length - 1);
  const validationLength = Math.min(model.contextSize, tokenIds.length - split - 1);
  const valInput = tokenIds.slice(split, split + validationLength);
  const valTarget = tokenIds.slice(split + 1, split + validationLength + 1);
  const steps = numberOption(args, "--steps", 50);
  const lr = numberOption(args, "--lr", 0.001);
  const seed = numberOption(args, "--seed", 42);
  if (!Number.isInteger(steps) || steps < 1 || steps > 100000) throw new Error("--steps must be an integer from 1 to 100000");
  if (!(lr > 0) || lr > 1) throw new Error("--lr must be > 0 and <= 1");
  const rng = seededRandom(seed ^ 0x7f4a7c15);
  const initialLoss = model.loss(valInput, valTarget).value;
  const losses = [];
  for (let step = 1; step <= steps; step += 1) {
    const maxStart = Math.max(0, trainIds.length - sequenceLength - 1);
    const start = Math.floor(rng() * (maxStart + 1));
    const input = trainIds.slice(start, start + sequenceLength);
    const target = trainIds.slice(start + 1, start + sequenceLength + 1);
    losses.push(model.trainStep(input, target, lr));
    if (step === 1 || step === steps || step % Math.max(1, Math.floor(steps / 10)) === 0) {
      process.stdout.write(`step ${step}/${steps} trainLoss=${losses.at(-1).toFixed(4)}\n`);
    }
  }
  const finalLoss = model.loss(valInput, valTarget).value;
  const outputPath = resolve(option(args, "--output", "experiments/llm-js/finetuned-checkpoint.json"));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ ...model.toJSON(), tokenizer: { type: "character", vocabulary } }), "utf8");
  process.stdout.write(`trainable=${policy.trainable.length} frozen=${policy.frozen} initialValidationLoss=${initialLoss.toFixed(4)} finalValidationLoss=${finalLoss.toFixed(4)}\ncheckpoint=${outputPath}\n`);
  return { initialLoss, finalLoss, trainableCount: policy.trainable.length, frozenCount: policy.frozen, outputPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  finetuneCli().catch((error) => {
    console.error(`llm-js fine-tune: ${error.message}`);
    process.exitCode = 1;
  });
}
