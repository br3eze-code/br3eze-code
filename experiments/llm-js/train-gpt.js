#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildVocabulary, seededRandom } from "./model.js";
import { TinyGPT } from "./gpt.js";

const DEFAULT_TEXT = "A tiny language model learns to predict the next character.\nSmall experiments make neural networks easier to understand.\n";

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
}

function numberOption(args, name, fallback) {
  const value = Number(option(args, name, String(fallback)));
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${name}`);
  return value;
}

export async function trainGPTCli(args = process.argv.slice(2)) {
  const inputPath = option(args, "--input", null);
  const text = inputPath ? await readFile(resolve(inputPath), "utf8") : DEFAULT_TEXT;
  const characters = [...text];
  if (characters.length < 4) throw new Error("Training input must contain at least 4 characters");

  const steps = numberOption(args, "--steps", 100);
  const contextSize = numberOption(args, "--context", 16);
  const width = numberOption(args, "--width", 8);\n  const heads = numberOption(args, "--heads", 2);\n  const layers = numberOption(args, "--layers", 1);
  const hiddenSize = numberOption(args, "--hidden", width * 4);
  const learningRate = numberOption(args, "--lr", 0.01);
  const seed = numberOption(args, "--seed", 42);
  const generatedLength = numberOption(args, "--generate", 80);
  if (!Number.isInteger(steps) || steps < 1 || steps > 100_000) throw new Error("--steps must be an integer from 1 to 100000");
  if (!Number.isInteger(contextSize) || contextSize < 2 || contextSize > 256) throw new Error("--context must be an integer from 2 to 256");
  if (!Number.isInteger(width) || width < 2 || width > 64) throw new Error("--width must be an integer from 2 to 64");\n  if (!Number.isInteger(heads) || heads < 1 || width % heads !== 0) throw new Error("--heads must be a positive integer that evenly divides --width");\n  if (!Number.isInteger(layers) || layers < 1 || layers > 12) throw new Error("--layers must be an integer from 1 to 12");
  if (!Number.isInteger(hiddenSize) || hiddenSize < 1 || hiddenSize > 256) throw new Error("--hidden must be an integer from 1 to 256");
  if (!(learningRate > 0) || learningRate > 1) throw new Error("--lr must be > 0 and <= 1");
  if (!Number.isInteger(generatedLength) || generatedLength < 0 || generatedLength > 10000) throw new Error("--generate must be an integer from 0 to 10000");

  const vocabulary = buildVocabulary(text);
  const tokenIds = characters.map((character) => vocabulary.indexOf(character));
  const splitIndex = Math.min(tokenIds.length - 2, Math.max(2, Math.floor(tokenIds.length * 0.9)));
  const trainSequenceLength = Math.min(contextSize, splitIndex - 1);
  const validationSequenceLength = Math.min(contextSize, tokenIds.length - splitIndex - 1);
  const rng = seededRandom(seed ^ 0x4c4c4d);
  const model = new TinyGPT(vocabulary.length, { contextSize, embeddingSize: width, hiddenSize, numHeads: heads, numLayers: layers, seed });
  const sampleTrainWindow = () => {
    const maxStart = splitIndex - trainSequenceLength - 1;
    const start = Math.floor(rng() * (maxStart + 1));
    return {
      input: tokenIds.slice(start, start + trainSequenceLength),
      target: tokenIds.slice(start + 1, start + trainSequenceLength + 1)
    };
  };
  const validationInput = tokenIds.slice(splitIndex, splitIndex + validationSequenceLength);
  const validationTarget = tokenIds.slice(splitIndex + 1, splitIndex + validationSequenceLength + 1);
  const initialLoss = model.loss(validationInput, validationTarget).value;
  let loss = initialLoss;
  for (let step = 1; step <= steps; step += 1) {
    const batch = sampleTrainWindow();
    loss = model.trainStep(batch.input, batch.target, learningRate);
    if (step === 1 || step === steps || step % Math.max(1, Math.floor(steps / 10)) === 0) {
      process.stdout.write(`step ${step}/${steps} trainLoss=${loss.toFixed(4)}\\n`);
    }
  }
  const finalLoss = model.loss(validationInput, validationTarget).value;
  process.stdout.write(`vocab=${vocabulary.length} context=${contextSize} width=${width} heads=${heads} layers=${layers} trainChars=${splitIndex} validationChars=${tokenIds.length - splitIndex} initialValidationLoss=${initialLoss.toFixed(4)} finalValidationLoss=${finalLoss.toFixed(4)}\\n`);

  const generatedIds = model.generate([tokenIds[0]], { maxNewTokens: generatedLength, seed });
  process.stdout.write("\n--- tiny GPT sample ---\n" + generatedIds.map((id) => vocabulary[id]).join("") + "\n");

  const checkpointPath = resolve(option(args, "--checkpoint", "experiments/llm-js/tiny-gpt-checkpoint.json"));
  await mkdir(dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, JSON.stringify({ ...model.toJSON(), tokenizer: { type: "character", vocabulary } }), "utf8");
  process.stdout.write(`checkpoint=${checkpointPath}\n`);
  return { initialLoss, finalLoss, vocabularySize: vocabulary.length, checkpoint: checkpointPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  trainGPTCli().catch((error) => {
    console.error(`llm-js GPT: ${error.message}`);
    process.exitCode = 1;
  });
}
