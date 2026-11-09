import { describe, expect, test } from '@jest/globals';
import { inspectTechnicalText } from '../../scripts/technical-writing-gate.mjs';

describe('STE-inspired technical writing gate', () => {
  test('accepts short instructions and ignores code identifiers', () => {
    expect(inspectTechnicalText('Open the Gateway. Check the status.')).toEqual([]);
    expect(inspectTechnicalText('Run `diagnostics.events` to read errors.')).toEqual([]);
  });

  test('reports vague terms', () => {
    expect(inspectTechnicalText('Simply restart the Gateway.', { file: 'example.md' }))
      .toEqual([expect.objectContaining({ file: 'example.md', rule: 'vague-term' })]);
  });

  test('reports sentences above the configured word limit', () => {
    const sentence = 'Open the Gateway and check the local dashboard before you reproduce the error and read the event list to confirm that the browser observer recorded the failed request with its status and safe path metadata.';
    expect(inspectTechnicalText(sentence, { maxWords: 12 }))
      .toEqual([expect.objectContaining({ rule: 'long-sentence' })]);
  });
});
