#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BigramLanguageModel, buildVocabulary, encodePairs, seededRandom } from './model.js';

const DEFAULT_TEXT = 'To learn is to predict the next character.\\nSmall models make the learning process visible.\\n';
function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
function numberOption(args, name, fallback) {
  const value = Number(option(args, name, String(fallback)));
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${name}`);
  return value;
}

export async function trainCli(args = process.argv.slice(2)) {
  const inputPath = option(args, '--input', null);
  const text = inputPath ? await readFile(resolve(inputPath), 'utf8') : DEFAULT_TEXT;
  if ([...text].length < 3) throw new Error('Training input must contain at least 3 characters');
  const steps = numberOption(args, '--steps', 1000);
  const lr = numberOption(args, '--lr', 0.1);
  const seed = numberOption(args, '--seed', 42);
  const generatedLength = numberOption(args, '--generate', 160);
  if (!Number.isInteger(steps) || steps < 1 || steps > 10_000_000) throw new Error('--steps must be an integer from 1 to 10000000');
  if (!(lr > 0) || lr > 10) throw new Error('--lr must be > 0 and <= 10');
  if (!Number.isInteger(generatedLength) || generatedLength < 0 || generatedLength > 100_000) throw new Error('--generate must be an integer from 0 to 100000');
  const vocab = buildVocabulary(text);
  const pairs = encodePairs(text, vocab);
  const model = new BigramLanguageModel(vocab, { seed });
  const initial = model.lossAndGradient(pairs).loss;
  const rng = seededRandom(seed ^ 0x51f15e);
  let loss = initial;
  for (let step = 1; step <= steps; step++) {
    // Shuffle-free SGD is deterministic and suitable for this tiny baseline.
    // Rotate through small minibatches to keep each update inexpensive.
    const batchSize = Math.min(64, pairs.length);
    const start = Math.floor(rng() * pairs.length);
    const batch = Array.from({ length: batchSize }, (_, i) => pairs[(start + i) % pairs.length]);
    loss = model.trainStep(batch, lr);
    if (step === 1 || step === steps || step % Math.max(1, Math.floor(steps / 10)) === 0) {
      process.stdout.write(`step ${step}/${steps} loss=${loss.toFixed(4)}\\n`);
    }
  }
  const finalLoss = model.lossAndGradient(pairs).loss;
  process.stdout.write(`vocab=${vocab.length} pairs=${pairs.length} initialLoss=${initial.toFixed(4)} finalLoss=${finalLoss.toFixed(4)}\\n`);
  if (args.includes('--generate') || !args.includes('--no-generate')) {
    process.stdout.write('\\n--- sample ---\\n' + model.generate({ length: generatedLength, seed }) + '\\n');
  }
  const checkpoint = resolve(option(args, '--checkpoint', 'experiments/llm-js/checkpoint.json'));
  await mkdir(dirname(checkpoint), { recursive: true });
  await writeFile(checkpoint, JSON.stringify(model.toJSON()), 'utf8');
  process.stdout.write(`checkpoint=${checkpoint}\\n`);
  return { initialLoss: initial, finalLoss, vocabSize: vocab.length, pairCount: pairs.length, checkpoint };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  trainCli().catch((error) => {
    console.error(`llm-js: ${error.message}`);
    process.exitCode = 1;
  });
}
