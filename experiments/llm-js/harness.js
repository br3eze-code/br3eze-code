/**
 * Provider-neutral Node.js harness for open-weight chat models exposed through
 * an OpenAI-compatible HTTP endpoint (llama.cpp server, vLLM, or similar).
 * Model execution stays in the backend; AgentOS owns policy, tools and routing.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}
function normalizeBaseUrl(value) {
  const url = new URL(requiredString(value, "baseUrl"));
  if (!["http:", "https:"].includes(url.protocol)) throw new TypeError("baseUrl must use HTTP or HTTPS");
  return url.toString().replace(/\/$/, "");
}
function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError("messages must be a non-empty array");
  return messages.map((message, index) => {
    if (!message || !["system", "user", "assistant", "tool"].includes(message.role) ||
        typeof message.content !== "string") {
      throw new TypeError(`messages[${index}] must have a supported role and string content`);
    }
    return { role: message.role, content: message.content };
  });
}
function timeoutSignal(timeoutMs, signal) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError("timeoutMs must be a positive integer");
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

export function createOpenAICompatibleAdapter({
  baseUrl,
  model,
  apiKey = process.env.OPENAI_COMPATIBLE_API_KEY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch
}) {
  const endpoint = normalizeBaseUrl(baseUrl);
  const modelId = requiredString(model, "model");
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible implementation is required");

  async function request(path, payload, signal) {
    const response = await fetchImpl(`${endpoint}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(payload),
      signal: timeoutSignal(timeoutMs, signal)
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 1200);
      throw new Error(`Model backend returned HTTP ${response.status}: ${body || response.statusText}`);
    }
    return response;
  }

  return Object.freeze({
    kind: "openai-compatible",
    model: modelId,
    baseUrl: endpoint,
    async generate({ messages, temperature = 0.2, maxTokens = 512, signal, responseFormat } = {}) {
      const normalized = normalizeMessages(messages);
      if (!(temperature >= 0 && temperature <= 2) || !Number.isFinite(temperature)) {
        throw new RangeError("temperature must be between 0 and 2");
      }
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 131072) {
        throw new RangeError("maxTokens must be an integer from 1 to 131072");
      }
      const payload = { model: modelId, messages: normalized, temperature, max_tokens: maxTokens, stream: false };
      if (responseFormat) payload.response_format = responseFormat;
      const response = await request("/chat/completions", payload, signal);
      const data = await response.json();
      const choice = data?.choices?.[0];
      if (typeof choice?.message?.content !== "string") {
        throw new TypeError("Model backend response did not contain choices[0].message.content");
      }
      return {
        text: choice.message.content,
        model: data.model ?? modelId,
        finishReason: choice.finish_reason ?? null,
        usage: data.usage ?? null,
        raw: data
      };
    },
    async *stream({ messages, temperature = 0.2, maxTokens = 512, signal } = {}) {
      const normalized = normalizeMessages(messages);
      if (!(temperature >= 0 && temperature <= 2) || !Number.isFinite(temperature)) {
        throw new RangeError("temperature must be between 0 and 2");
      }
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 131072) {
        throw new RangeError("maxTokens must be an integer from 1 to 131072");
      }
      const response = await request("/chat/completions", {
        model: modelId, messages: normalized, temperature, max_tokens: maxTokens, stream: true
      }, signal);
      if (!response.body?.getReader) throw new TypeError("Streaming response body is not readable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop() ?? "";
          for (const event of events) {
            for (const line of event.split(/\r?\n/)) {
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              let parsed;
              try { parsed = JSON.parse(data); } catch { throw new TypeError("Invalid JSON event from model stream"); }
              const delta = parsed?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length) yield delta;
            }
          }
          if (done) break;
        }
        if (buffer.trim()) {
          for (const line of buffer.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length) yield delta;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
  });
}

/** Registry separates stable logical model names from deployment endpoints. */
export class ModelHarness {
  #adapters = new Map();
  register(name, adapter) {
    const key = requiredString(name, "name");
    if (!adapter || typeof adapter.generate !== "function" || typeof adapter.stream !== "function") {
      throw new TypeError("adapter must implement generate() and stream()");
    }
    if (this.#adapters.has(key)) throw new Error(`model adapter already registered: ${key}`);
    this.#adapters.set(key, adapter);
    return this;
  }
  get(name) {
    const adapter = this.#adapters.get(requiredString(name, "name"));
    if (!adapter) throw new Error(`unknown model adapter: ${name}`);
    return adapter;
  }
  list() {
    return [...this.#adapters].map(([name, adapter]) => ({
      name, kind: adapter.kind ?? "custom", model: adapter.model ?? null, baseUrl: adapter.baseUrl ?? null
    }));
  }
  generate(name, request) { return this.get(name).generate(request); }
  stream(name, request) { return this.get(name).stream(request); }
}
