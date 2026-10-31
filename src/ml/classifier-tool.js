import { predictClass } from './trainable-classifier.js';

/**
 * Expose the trained classifier through AgentOS's standard tool contract.
 * Register this tool with the host runtime; predictions never authorize actions.
 */
export function createClassifierTool({ modelDir } = {}) {
  if (typeof modelDir !== 'string' || !modelDir.trim()) {
    throw new TypeError('modelDir must be a non-empty path to a trained classifier artifact');
  }

  return Object.freeze({
    name: 'ml.classify',
    description: 'Classify a numeric feature vector with the configured local model.',
    parameters: {
      type: 'object',
      properties: {
        features: {
          type: 'array',
          items: { type: 'number' },
          minItems: 1,
          description: 'Numeric feature vector matching the trained model input shape.',
        },
      },
      required: ['features'],
      additionalProperties: false,
    },
    permissions: ['model:classify'],
    risk: 'low',
    execute: async (args = {}) => {
      if (!Array.isArray(args.features)) {
        throw new TypeError('features must be a numeric array');
      }
      return predictClass(modelDir, args.features);
    },
  });
}
