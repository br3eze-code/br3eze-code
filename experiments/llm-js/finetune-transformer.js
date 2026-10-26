#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TransformerLM } from "./general-transformer.js";
import { configureTransformerTrainableParameters } from "./transformer-finetune-policy.js";

function option(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}
function numberOption(args, name, fallback) {
  const value = Number(option(args, name, String(fallback)));
  if (!Number.isFinite(value)) throw new Error(`invalid numeric value for ${name}`);
  return value;
}
function rngFor(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export async function finetuneTransformerCli(args = process.argv.slice(2)) {
  const checkpointPath = option(args, "--checkpoint");
  const inputPath = option(args, "--input");
  if (!checkpointPath || !inputPath) throw new Error("--checkpoint and --input are required");
  const [saved, text] = await Promise.all([
    readFile(resolve(checkpointPath), "utf8").then(JSON.parse),
    readFile(resolve(inputPath), "utf8")
  ]);
  if (saved.format !== "br3eze-transformer-training-v1" || !Array.isArray(saved.vocabulary) || !saved.model) {
    throw new Error("checkpoint must be a br3eze-transformer-training-v1 training checkpoint");
  }
  if (typeof text !== "string" || [...text].length < 12) throw new Error("fine-tuning text must contain at least 12 characters");
  const vocabulary = saved.vocabulary;
  const vocabIndex = new Map(vocabulary.map((character, index) => [character, index]));
  const unknown = [...new Set([...text].filter(character => !vocabIndex.has(character)))];
  if (unknown.length) throw new Error(`input contains ${unknown.length} character(s) outside the checkpoint vocabulary; extend/retrain the tokenizer first`);
  const ids = [...text].map(character => vocabIndex.get(character));
  const model = TransformerLM.fromJSON(saved.model);
  if (model.vocabSize !== vocabulary.length) throw new Error("checkpoint vocabulary size does not match model vocabSize");
  const policy = configureTransformerTrainableParameters(model, {
    freezeBase: args.includes("--freeze-base"),
    unfreezeHeadOnly: args.includes("--unfreeze-head-only"),
    trainFinalNorm: !args.includes("--freeze-final-norm")
  });
  const steps = numberOption(args, "--steps", 100);
  const learningRate = numberOption(args, "--lr", 0.0005);
  const seed = numberOption(args, "--seed", 42);
  if (!Number.isInteger(steps) || steps < 1 || steps > 100000) throw new Error("--steps must be an integer from 1 to 100000");
  if (!(learningRate > 0) || learningRate > 0.1) throw new Error("--lr must be > 0 and <= 0.1");
  if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
  const context = model.contextSize;
  const split = Math.min(ids.length - 2, Math.max(context + 1, Math.floor(ids.length * 0.9)));
  if (split >= ids.length - 1) throw new Error("not enough text for a training/validation split; provide more text or use a smaller context size");
  const train = ids.slice(0, split);
  const validation = ids.slice(split);
  if (train.length < 3 || validation.length < 2) throw new Error("training and validation partitions are too small");
  const rng = rngFor(seed ^ 0x7f4a7c15);
  const sample = source => {
    const length = Math.min(context, source.length - 1);
    const start = Math.floor(rng() * (source.length - length));
    return { inputs: source.slice(start, start + length), targets: source.slice(start + 1, start + length + 1) };
  };
  const evaluate = () => {
    const batch = sample(validation);
    return model.loss(batch.inputs, batch.targets).value;
  };
  const initialValidation = evaluate();
  for (let step = 1; step <= steps; step++) {
    const batch = sample(train);
    const loss = model.trainStep(batch.inputs, batch.targets, { learningRate });
    if (step === 1 || step === steps || step % Math.max(1, Math.floor(steps / 10)) === 0) {
      process.stdout.write(`step ${step}/${steps} trainLoss=${loss.toFixed(4)}\n`);
    }
  }
  const finalValidation = evaluate();
  const outputPath = resolve(option(args, "--output", "experiments/llm-js/transformer-finetuned.json"));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ ...model.toJSON(), format: "br3eze-transformer-training-v1", vocabulary }), "utf8");
  process.stdout.write(`trainable=${policy.trainableCount} frozen=${policy.frozenCount} validationLossBefore=${initialValidation.toFixed(4)} validationLossAfter=${finalValidation.toFixed(4)}\ncheckpoint=${outputPath}\n`);
  return { initialValidation, finalValidation, trainableCount: policy.trainableCount, frozenCount: policy.frozenCount, outputPath };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  finetuneTransformerCli().catch(error => { console.error("transformer fine-tune: " + error.message); process.exitCode = 1; });
}
