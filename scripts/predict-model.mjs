#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { predictClass } from '../src/ml/trainable-classifier.js';

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
  if (!args.features) throw new Error('Provide --features as comma-separated numbers, for example --features 0.8,0.7,0.2');
  const features = args.features.split(',').map((value) => Number(value.trim()));
  if (!features.every(Number.isFinite)) throw new Error('--features must contain only finite numbers');
  const modelDir = path.resolve(args.model || path.join(root, 'artifacts/br3eze-classifier'));
  const result = await predictClass(modelDir, features);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Model prediction failed: ${error.message}`);
  process.exitCode = 1;
}
