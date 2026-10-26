import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MODEL_FILE = 'model.json';

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
    if (!row.features.every(Number.isFinite)) {
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

function randomGenerator(seed = 4096) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
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

function zeros(length) {
  return Array.from({ length }, () => 0);
}

function zeroMatrix(rows, columns) {
  return Array.from({ length: rows }, () => zeros(columns));
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function createNetwork(featureCount, classCount, random) {
  const hiddenUnits = Math.max(8, Math.min(32, featureCount * 4));
  const weight = () => (random() - 0.5) * 0.2;
  return {
    hiddenUnits,
    w1: Array.from({ length: featureCount }, () => Array.from({ length: hiddenUnits }, weight)),
    b1: zeros(hiddenUnits),
    w2: Array.from({ length: hiddenUnits }, () => Array.from({ length: classCount }, weight)),
    b2: zeros(classCount),
  };
}

function forward(network, features) {
  const hiddenPre = network.b1.map((bias, unit) =>
    bias + features.reduce((sum, value, index) => sum + value * network.w1[index][unit], 0));
  const hidden = hiddenPre.map((value) => Math.max(0, value));
  const logits = network.b2.map((bias, label) =>
    bias + hidden.reduce((sum, value, unit) => sum + value * network.w2[unit][label], 0));
  return { hiddenPre, hidden, probabilities: softmax(logits) };
}

function trainBatch(network, batch, learningRate, classCount, featureCount) {
  const gW1 = zeroMatrix(featureCount, network.hiddenUnits);
  const gB1 = zeros(network.hiddenUnits);
  const gW2 = zeroMatrix(network.hiddenUnits, classCount);
  const gB2 = zeros(classCount);

  for (const row of batch) {
    const { hiddenPre, hidden, probabilities } = forward(network, row.features);
    const dLogits = probabilities.map((value, index) => value - Number(index === row.labelIndex));
    for (let unit = 0; unit < network.hiddenUnits; unit += 1) {
      for (let label = 0; label < classCount; label += 1) {
        gW2[unit][label] += hidden[unit] * dLogits[label];
      }
    }
    for (let label = 0; label < classCount; label += 1) gB2[label] += dLogits[label];

    for (let unit = 0; unit < network.hiddenUnits; unit += 1) {
      const derivative = hiddenPre[unit] > 0
        ? network.w2[unit].reduce((sum, weight, label) => sum + weight * dLogits[label], 0)
        : 0;
      gB1[unit] += derivative;
      for (let feature = 0; feature < featureCount; feature += 1) {
        gW1[feature][unit] += row.features[feature] * derivative;
      }
    }
  }

  const rate = learningRate / batch.length;
  for (let feature = 0; feature < featureCount; feature += 1) {
    for (let unit = 0; unit < network.hiddenUnits; unit += 1) network.w1[feature][unit] -= rate * gW1[feature][unit];
  }
  for (let unit = 0; unit < network.hiddenUnits; unit += 1) {
    network.b1[unit] -= rate * gB1[unit];
    for (let label = 0; label < classCount; label += 1) network.w2[unit][label] -= rate * gW2[unit][label];
  }
  for (let label = 0; label < classCount; label += 1) network.b2[label] -= rate * gB2[label];
}

function evaluate(network, rows) {
  if (!rows.length) return { loss: null, accuracy: null };
  let totalLoss = 0;
  let correct = 0;
  for (const row of rows) {
    const probabilities = forward(network, row.features).probabilities;
    totalLoss -= Math.log(Math.max(probabilities[row.labelIndex], 1e-12));
    if (probabilities.indexOf(Math.max(...probabilities)) === row.labelIndex) correct += 1;
  }
  return { loss: totalLoss / rows.length, accuracy: correct / rows.length };
}

function prepareRows(rows, labels, means, scales) {
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  return rows.map((row) => ({
    features: normalizeFeatures(row.features, means, scales),
    labelIndex: labelIndex.get(row.label.trim()),
  }));
}

export async function trainClassifier(rows, {
  outputDir = path.resolve('artifacts/br3eze-classifier'),
  epochs = 300,
  batchSize = 4,
  learningRate = 0.03,
} = {}) {
  const { featureCount, labels } = validateDataset(rows);
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 10000) {
    throw new RangeError('epochs must be an integer from 1 to 10000');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('batchSize must be a positive integer');
  if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 1) {
    throw new RangeError('learningRate must be greater than 0 and at most 1');
  }

  const random = randomGenerator();
  const shuffledIndices = shuffled(rows.map((_, index) => index), random);
  const validationCount = rows.length >= 10 ? Math.max(2, Math.floor(rows.length * 0.2)) : 0;
  const validationIndices = new Set(shuffledIndices.slice(0, validationCount));
  const rawTrainingRows = rows.filter((_, index) => !validationIndices.has(index));
  const rawValidationRows = rows.filter((_, index) => validationIndices.has(index));
  // Fit normalization on training rows only to avoid leaking held-out statistics.
  const { means, scales } = computeNormalizer(rawTrainingRows, featureCount);
  const trainingRows = prepareRows(rawTrainingRows, labels, means, scales);
  const validationRows = prepareRows(rawValidationRows, labels, means, scales);
  const network = createNetwork(featureCount, labels.length, random);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const epochRows = shuffled(trainingRows, random);
    for (let start = 0; start < epochRows.length; start += batchSize) {
      trainBatch(network, epochRows.slice(start, start + batchSize), learningRate, labels.length, featureCount);
    }
  }

  const trainMetrics = evaluate(network, trainingRows);
  const validationMetrics = evaluate(network, validationRows);
  const artifact = {
    schemaVersion: 1,
    task: 'multiclass-classification',
    architecture: { type: 'dense-relu-softmax', featureCount, hiddenUnits: network.hiddenUnits, classCount: labels.length },
    labels,
    means,
    scales,
    weights: { w1: network.w1, b1: network.b1, w2: network.w2, b2: network.b2 },
    training: {
      exampleCount: rows.length,
      trainingExampleCount: trainingRows.length,
      validationExampleCount: validationRows.length,
      epochs,
      batchSize,
      learningRate,
      trainedAt: new Date().toISOString(),
      train: trainMetrics,
      validation: validationMetrics,
    },
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, MODEL_FILE), JSON.stringify(artifact, null, 2));

  return {
    outputDir,
    exampleCount: rows.length,
    featureCount,
    labels,
    epochs,
    loss: trainMetrics.loss,
    accuracy: trainMetrics.accuracy,
    validationLoss: validationMetrics.loss,
    validationAccuracy: validationMetrics.accuracy,
  };
}

export async function loadClassifier(modelDir) {
  const artifact = JSON.parse(await readFile(path.join(modelDir, MODEL_FILE), 'utf8'));
  if (artifact.schemaVersion !== 1 || artifact.task !== 'multiclass-classification') {
    throw new Error('Unsupported or missing model artifact schema');
  }
  const { architecture, labels, means, scales, weights } = artifact;
  if (!architecture || !Array.isArray(labels) || !labels.length ||
      !Array.isArray(means) || !Array.isArray(scales) ||
      means.length !== architecture.featureCount || scales.length !== architecture.featureCount ||
      !weights?.w1 || !weights?.b1 || !weights?.w2 || !weights?.b2) {
    throw new Error('Model artifact is incomplete');
  }
  return artifact;
}

export async function predictClass(modelDir, features) {
  const artifact = await loadClassifier(modelDir);
  const { architecture, labels, means, scales, weights } = artifact;
  const normalized = normalizeFeatures(features, means, scales);
  const network = {
    hiddenUnits: architecture.hiddenUnits,
    w1: weights.w1,
    b1: weights.b1,
    w2: weights.w2,
    b2: weights.b2,
  };
  const probabilities = forward(network, normalized).probabilities;
  const ranked = labels.map((label, index) => ({ label, confidence: probabilities[index] }))
    .sort((a, b) => b.confidence - a.confidence);
  return { label: ranked[0].label, confidence: ranked[0].confidence, probabilities: ranked };
}
