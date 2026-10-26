#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonlDataset, trainClassifier } from '../src/ml/trainable-classifier.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const dataPath = path.resolve(args.data || path.join(root, 'examples/model-training/triage.jsonl'));
  const outputDir = path.resolve(args.out || path.join(root, 'artifacts/br3eze-classifier'));
  const rows = await readJsonlDataset(dataPath);
  const result = await trainClassifier(rows, {
    outputDir,
    epochs: Number(args.epochs || 80),
    batchSize: Number(args['batch-size'] || 8),
  });
  console.log(JSON.stringify({ status: 'trained', ...result }, null, 2));
} catch (error) {
  console.error(`Model training failed: ${error.message}`);
  process.exitCode = 1;
}
