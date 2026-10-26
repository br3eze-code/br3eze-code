/**
 * Normalize visible model output without exposing private chain-of-thought.
 * Raw <think> blocks are deliberately discarded, not persisted or shown to users.
 * Providers may separately supply a documented, user-safe reasoning summary.
 */
export function processModelOutput(rawText, { reasoningSummary = null } = {}) {
  const text = String(rawText ?? '');
  const sanitizedOutput = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  return {
    sanitizedOutput,
    reasoningSummary: typeof reasoningSummary === 'string' ? reasoningSummary.trim() || null : null,
  };
}
export default processModelOutput;
