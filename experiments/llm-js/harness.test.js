import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAICompatibleAdapter, ModelHarness } from "./harness.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("OpenAI-compatible adapter sends chat completion and normalizes response", async () => {
  let received;
  const adapter = createOpenAICompatibleAdapter({
    baseUrl: "http://127.0.0.1:8080/v1/",
    model: "open-model",
    apiKey: "local-key",
    fetchImpl: async (url, init) => {
      received = { url, init, body: JSON.parse(init.body) };
      return jsonResponse({ model: "open-model-v2", choices: [{ message: { content: "Hello" }, finish_reason: "stop" }], usage: { total_tokens: 4 } });
    }
  });
  const result = await adapter.generate({ messages: [{ role: "user", content: "Hi" }], maxTokens: 20 });
  assert.equal(received.url, "http://127.0.0.1:8080/v1/chat/completions");
  assert.equal(received.init.headers.authorization, "Bearer local-key");
  assert.equal(received.body.model, "open-model");
  assert.equal(result.text, "Hello");
  assert.equal(result.model, "open-model-v2");
});

test("adapter validates inputs and surfaces backend errors", async () => {
  const adapter = createOpenAICompatibleAdapter({
    baseUrl: "http://localhost:8080/v1", model: "x",
    fetchImpl: async () => new Response("bad model", { status: 404 })
  });
  await assert.rejects(adapter.generate({ messages: [] }), /messages must be a non-empty array/);
  await assert.rejects(adapter.generate({ messages: [{ role: "user", content: "hi" }] }), /HTTP 404/);
});

test("harness registers logical model names and routes requests", async () => {
  const adapter = createOpenAICompatibleAdapter({
    baseUrl: "http://localhost:8080/v1", model: "qwen-local",
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: "routed" } }] })
  });
  const harness = new ModelHarness().register("reasoner", adapter);
  assert.deepEqual(harness.list().map((item) => item.name), ["reasoner"]);
  assert.equal((await harness.generate("reasoner", { messages: [{ role: "user", content: "hi" }] })).text, "routed");
  assert.throws(() => harness.get("missing"), /unknown model adapter/);
  assert.throws(() => harness.register("reasoner", adapter), /already registered/);
});

test("adapter parses server-sent streaming deltas", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"open "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"model"}}]}\n\n',
    "data: [DONE]\n\n"
  ];
  const body = new ReadableStream({
    pull(controller) {
      if (!chunks.length) return controller.close();
      controller.enqueue(new TextEncoder().encode(chunks.shift()));
    }
  });
  const adapter = createOpenAICompatibleAdapter({
    baseUrl: "http://localhost:8080/v1", model: "x",
    fetchImpl: async () => new Response(body, { status: 200 })
  });
  const result = [];
  for await (const token of adapter.stream({ messages: [{ role: "user", content: "hi" }] })) result.push(token);
  assert.equal(result.join(""), "open model");
});


test("adapter forwards function tools and normalizes tool-call responses", async () => {
  let requestBody;
  const adapter = createOpenAICompatibleAdapter({
    baseUrl: "http://localhost:8080/v1",
    model: "tool-capable-model",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return jsonResponse({
        model: "tool-capable-model",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: { name: "search_records", arguments: '{"query":"latest"}' }
            }]
          }
        }]
      });
    }
  });
  const result = await adapter.generate({
    messages: [{ role: "user", content: "Search records" }],
    tools: [{ type: "function", function: { name: "search_records", parameters: { type: "object" } } }],
    toolChoice: "auto"
  });
  assert.equal(requestBody.tool_choice, "auto");
  assert.equal(requestBody.tools[0].function.name, "search_records");
  assert.equal(result.text, "");
  assert.deepEqual(result.toolCalls, [{ id: "call-1", name: "search_records", arguments: '{"query":"latest"}' }]);
});
