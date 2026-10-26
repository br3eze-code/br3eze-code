import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { predictClass, trainClassifier, validateDataset } from '../../src/ml/trainable-classifier.js';
import { createClassifierTool } from '../../src/ml/classifier-tool.js';

describe('trainable classifier dataset contract', () => {
  test('accepts numeric vectors with two or more labels', () => {
    const rows = [
      { features: [0, 1], label: 'a' },
      { features: [1, 0], label: 'b' },
      { features: [0.2, 0.8], label: 'a' },
      { features: [0.8, 0.2], label: 'b' },
      { features: [0.1, 0.9], label: 'a' },
      { features: [0.9, 0.1], label: 'b' },
    ];
    expect(validateDataset(rows)).toEqual({ featureCount: 2, labels: ['a', 'b'] });
  });

  test('rejects datasets with too few examples', () => {
    expect(() => validateDataset([{ features: [1], label: 'a' }])).toThrow(/at least 6/);
  });

  test('rejects inconsistent feature lengths', () => {
    expect(() => validateDataset([
      { features: [1], label: 'a' },
      { features: [2, 3], label: 'b' },
      { features: [3], label: 'a' },
      { features: [4], label: 'b' },
      { features: [5], label: 'a' },
      { features: [6], label: 'b' },
    ])).toThrow(/same non-empty feature vector length/);
  });

  test('rejects non-finite feature values', () => {
    expect(() => validateDataset([
      { features: [1], label: 'a' },
      { features: [2], label: 'b' },
      { features: [3], label: 'a' },
      { features: [4], label: 'b' },
      { features: [5], label: 'a' },
      { features: [Number.NaN], label: 'b' },
    ])).toThrow(/non-finite/);
  });

  test('requires at least two labels', () => {
    expect(() => validateDataset(Array.from({ length: 6 }, (_, index) => ({
      features: [index],
      label: 'same',
    })))).toThrow(/two distinct labels/);
  });


  test('fits feature normalization on training rows only', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'agentos-normalizer-'));
    const rows = Array.from({ length: 10 }, (_, index) => ({
      features: [index === 9 ? 10000 : index],
      label: index % 2 === 0 ? 'even' : 'odd',
    }));
    // Mirror the documented seeded shuffle to calculate the training partition.
    let state = 4096 >>> 0;
    const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    const indices = Array.from({ length: rows.length }, (_, index) => index);
    for (let index = indices.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
    }
    const validation = new Set(indices.slice(0, 2));
    const expectedTraining = rows.filter((_, index) => !validation.has(index));
    const expectedMean = expectedTraining.reduce((sum, row) => sum + row.features[0], 0) / expectedTraining.length;
    try {
      await trainClassifier(rows, { outputDir, epochs: 1, batchSize: 4 });
      const artifact = JSON.parse(await readFile(path.join(outputDir, 'model.json'), 'utf8'));
      expect(artifact.means[0]).toBeCloseTo(expectedMean, 10);
      expect(artifact.training.validationExampleCount).toBe(2);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  test('trains, saves, reloads, and predicts from a model artifact', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'agentos-model-'));
    const rows = [
      { features: [-1], label: 'negative' },
      { features: [-0.9], label: 'negative' },
      { features: [-0.7], label: 'negative' },
      { features: [-0.5], label: 'negative' },
      { features: [0.5], label: 'positive' },
      { features: [0.7], label: 'positive' },
      { features: [0.9], label: 'positive' },
      { features: [1], label: 'positive' },
    ];
    try {
      const trained = await trainClassifier(rows, { outputDir, epochs: 160, batchSize: 4 });
      const prediction = await predictClass(outputDir, [0.95]);
      expect(trained.exampleCount).toBe(8);
      expect(prediction.label).toBe('positive');
      expect(prediction.probabilities).toHaveLength(2);
      const tool = createClassifierTool({ modelDir: outputDir });
      expect(tool.name).toBe('ml.classify');
      await expect(tool.execute({ features: [0.95] })).resolves.toMatchObject({ label: 'positive' });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});
