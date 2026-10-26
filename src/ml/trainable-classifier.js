import * as tf from '@tensorflow/tfjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MANIFEST_FILE = 'model.json';
const WEIGHTS_FILE = 'weights.bin';

export function validateDataset(rows) {
  if (!Array.isArray(rows) || rows.length < 6) {
    throw new TypeError('Dataset must contain at least 6 labelled examples');
  }

  let featureCount = null;
  const labels = new Set();

  rows.forEach((row, index) => {
    if (!row || !Array.isArray(row.features) || typeof row.label !== 'string' || !row.label.trim()) {
      throw new TypeError(`Example ${index + 1} must contain numeric features and a non-empty label`);
    }
    if (featureCount === null) featureCount = row.features.length;
    if (row.features.length !== featureCount || featureCount < 1) {
      throw new TypeError('Every example must use the same non-empty feature vector length');
    }
    if (!row.features.every((value) => Number.isFinite(value))) {
      throw new TypeError(`Example ${index + 1} contains a non-finite feature`);
    }
    labels.add(row.label.trim());
  });

  if (labels.size < 2) throw new TypeError('Dataset must contain at least two distinct labels');
  return { featureCount, labels: [...labels].sort() };
}

export async function readJsonlDataset(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const rows = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new TypeError(`Invalid JSON on dataset line ${index + 1}`);
    }
  });
  validateDataset(rows);
  return rows;
}

function computeNormalizer(rows, featureCount) {
  const means = Array.from({ length: featureCount }, (_, index) =>
    rows.reduce((sum, row) => sum + row.features[index], 0) / rows.length);
  const scales = means.map((mean, index) => {
    const variance = rows.reduce((sum, row) => sum + ((row.features[index] - mean) ** 2), 0) / rows.length;
    return Math.sqrt(variance) || 1;
  });
  return { means, scales };
}

function normalizeFeatures(features, means, scales) {
  if (!Array.isArray(features) || features.length !== means.length || !features.every(Number.isFinite)) {
    throw new TypeError(`features must be an array of ${means.length} finite numbers`);
  }
  return features.map((value, index) => (value - means[index]) / scales[index]);
}

function createNetwork(featureCount, classCount) {
  const model = tf.sequential();
  model.add(tf.layers.dense({
    inputShape: [featureCount],
    units: Math.max(8, Math.min(64, featureCount * 4)),
    activation: 'relu',
  }));
  model.add(tf.layers.dense({ units: classCount, activation: 'softmax' }));
  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: 'categoricalCrossentropy',
    metrics: ['accuracy'],
  });
  return model;
}

async function saveArtifacts(model, outputDir, metadata) {
  await mkdir(outputDir, { recursive: true });
  await model.save(tf.io.withSaveHandler(async (artifacts) => {
    const manifest = {
      format: artifacts.format,
      generatedBy: artifacts.generatedBy,
      convertedBy: artifacts.convertedBy,
      modelTopology: artifacts.modelTopology,
      weightSpecs: artifacts.weightSpecs,
      userDefinedMetadata: metadata,
    };
    await writeFile(path.join(outputDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
    await writeFile(path.join(outputDir, WEIGHTS_FILE), Buffer.from(artifacts.weightData));
    return {
      modelArtifactsInfo: {
        dateSaved: new Date(),
        modelTopologyType: 'JSON',
        modelTopologyBytes: Buffer.byteLength(JSON.stringify(artifacts.modelTopology)),
        weightSpecsBytes: Buffer.byteLength(JSON.stringify(artifacts.weightSpecs)),
        weightDataBytes: artifacts.weightData.byteLength,
      },
    };
  }));
}

export async function trainClassifier(rows, {
  outputDir = path.resolve('artifacts/br3eze-classifier'),
  epochs = 80,
  batchSize = 8,
} = {}) {
  await tf.ready();
  const { featureCount, labels } = validateDataset(rows);
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 2000) {
    throw new RangeError('epochs must be an integer from 1 to 2000');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('batchSize must be a positive integer');

  const { means, scales } = computeNormalizer(rows, featureCount);
  const normalized = rows.map((row) => normalizeFeatures(row.features, means, scales));
  const oneHot = rows.map((row) => labels.map((label) => Number(label === row.label.trim())));
  const xs = tf.tensor2d(normalized, [rows.length, featureCount]);
  const ys = tf.tensor2d(oneHot, [rows.length, labels.length]);
  const model = createNetwork(featureCount, labels.length);

  try {
    const history = await model.fit(xs, ys, {
      epochs,
      batchSize: Math.min(batchSize, rows.length),
      shuffle: true,
      validationSplit: rows.length >= 10 ? 0.2 : 0,
      verbose: 0,
    });
    const final = (key) => {
      const values = history.history[key];
      return Array.isArray(values) && values.length ? Number(values.at(-1)) : null;
    };
    const metadata = {
      schemaVersion: 1,
      task: 'multiclass-classification',
      labels,
      featureCount,
      means,
      scales,
      exampleCount: rows.length,
      epochs,
      trainedAt: new Date().toISOString(),
    };
    await saveArtifacts(model, outputDir, metadata);
    return {
      outputDir,
      exampleCount: rows.length,
      featureCount,
      labels,
      epochs,
      loss: final('loss'),
      accuracy: final('accuracy'),
      validationLoss: final('val_loss'),
      validationAccuracy: final('val_accuracy'),
    };
  } finally {
    xs.dispose();
    ys.dispose();
    model.dispose();
  }
}

export async function loadClassifier(modelDir) {
  await tf.ready();
  const manifest = JSON.parse(await readFile(path.join(modelDir, MANIFEST_FILE), 'utf8'));
  const weightBuffer = await readFile(path.join(modelDir, WEIGHTS_FILE));
  if (manifest.schemaVersion !== 1 && manifest.userDefinedMetadata?.schemaVersion !== 1) {
    throw new Error('Unsupported or missing model metadata schema');
  }
  const metadata = manifest.userDefinedMetadata;
  if (!Array.isArray(metadata?.labels) || !Array.isArray(metadata?.means) ||
      !Array.isArray(metadata?.scales) || metadata.featureCount < 1) {
    throw new Error('Model metadata is incomplete');
  }
  const weightData = Uint8Array.from(weightBuffer).buffer;
  const handler = tf.io.fromMemory({
    format: manifest.format,
    generatedBy: manifest.generatedBy,
    convertedBy: manifest.convertedBy,
    modelTopology: manifest.modelTopology,
    weightSpecs: manifest.weightSpecs,
    weightData,
    userDefinedMetadata: metadata,
  });
  const model = await tf.loadLayersModel(handler);
  return { model, metadata };
}

export async function predictClass(modelDir, features) {
  const { model, metadata } = await loadClassifier(modelDir);
  let input;
  let output;
  try {
    const normalized = normalizeFeatures(features, metadata.means, metadata.scales);
    input = tf.tensor2d([normalized], [1, metadata.featureCount]);
    output = model.predict(input);
    const probabilities = Array.from(await output.data());
    const ranked = metadata.labels.map((label, index) => ({ label, confidence: probabilities[index] }))
      .sort((a, b) => b.confidence - a.confidence);
    return { label: ranked[0].label, confidence: ranked[0].confidence, probabilities: ranked };
  } finally {
    input?.dispose();
    output?.dispose();
    model.dispose();
  }
}
