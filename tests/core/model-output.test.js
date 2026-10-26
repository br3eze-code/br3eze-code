import { processModelOutput } from '../../src/core/model-output.js';

describe('processModelOutput', () => {
  test('removes raw think blocks from user-visible output', () => {
    expect(processModelOutput('Hello <think>private reasoning</think> world').sanitizedOutput).toBe('Hello  world');
  });

  test('does not emit raw reasoning as a trace', () => {
    const result = processModelOutput('<think>secret</think>answer');
    expect(result).toEqual({ sanitizedOutput: 'answer', reasoningSummary: null });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  test('accepts a separate user-safe summary', () => {
    expect(processModelOutput('answer', { reasoningSummary: 'Compared two options.' }).reasoningSummary).toBe('Compared two options.');
  });
});
