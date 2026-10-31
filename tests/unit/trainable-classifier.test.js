import { mkdtemp, rm } from 'node:fs/promises';
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
