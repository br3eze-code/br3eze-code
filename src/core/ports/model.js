/**
 * Domain-neutral model execution port.
 *
 * Core asks for a model completion; adapters decide whether the backing
 * provider is Gemini, Anthropic, OpenAI, a local model, or something else.
 */
export const MODEL_PORT_VERSION = '1.0';

export function validateModelPort(model) {
  if (!model || typeof model !== 'object') throw new TypeError('model port is required');
  if (typeof model.execute !== 'function') throw new TypeError('model port must implement execute(messages, tools, options)');
  return model;
}

export function createModelRequest({ messages = [], tools = [], context = {}, signal = null } = {}) {
  return Object.freeze({
    version: MODEL_PORT_VERSION,
    messages: Object.freeze([...messages]),
    tools: Object.freeze([...tools]),
    context: Object.freeze({ ...context }),
    signal,
  });
}
