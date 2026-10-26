import { validateDataset } from '../../src/ml/trainable-classifier.js';

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
});
