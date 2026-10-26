import test from "node:test";
import assert from "node:assert/strict";
import { runToolAgent } from "./tool-agent.js";

const echoTool = {
  name: "lookup_record",
  description: "Look up a record by key",
  parameters: {
    type: "object",
    properties: { key: { type: "string", minLength: 1, maxLength: 40 } },
    required: ["key"],
    additionalProperties: false
  },
  execute: async ({ key }) => ({ key, value: "found" })
};

test("runs a model-selected tool only after schema validation and authorization", async () => {
  const requests = [];
  let executions = 0;
  const model = {
    async generate(request) {
      requests.push(request);
      if (requests.length === 1) {
        return { text: "", model: "mock-open-model", toolCalls: [{ id: "call-1", name: "lookup_record", arguments: JSON.stringify({ key: "alpha" }) }] };
      }
      return { text: "The record was found.", toolCalls: [], usage: { total_tokens: 12 } };
    }
  };
  const events = [];
  const result = await runToolAgent({
    model,
    messages: [{ role: "user", content: "Find alpha" }],
    tools: [{ ...echoTool, execute: async ({ key }) => { executions += 1; return { key, value: "found" }; } }],
    authorizeTool: async ({ tool, context }) => tool.name === "lookup_record" && context.userId === "user-1",
    context: { userId: "user-1", tenantId: "tenant-1" },
    onEvent: (event) => events.push(event)
  });
  assert.equal(result.answer, "The record was found.");
  assert.equal(result.steps, 2);
  assert.equal(requests[0].tools[0].function.name, "lookup_record");
  assert.equal(requests[1].messages.at(-1).role, "tool");
  assert.match(requests[1].messages.at(-1).content, /"value":"found"/);
  assert.deepEqual(events.map((event) => event.type), ["tool_call", "tool_result", "done"]);
  assert.equal(executions, 1);
});

test("denies tool execution unless the authorization callback returns true", async () => {
  let executed = false;
  const model = {
    async generate({ messages }) {
      if (!messages.some((message) => message.role === "tool")) {
        return { text: "", toolCalls: [{ id: "call-denied", name: "lookup_record", arguments: '{"key":"alpha"}' }] };
      }
      return { text: "Access denied.", toolCalls: [] };
    }
  };
  const result = await runToolAgent({
    model,
    messages: [{ role: "user", content: "Find alpha" }],
    tools: [{ ...echoTool, execute: async () => { executed = true; return "no"; } }],
    authorizeTool: async () => false
  });
  assert.equal(executed, false);
  assert.match(result.messages.find((message) => message.role === "tool").content, /TOOL_NOT_AUTHORIZED/);
});

test("rejects schema-invalid tool arguments without executing the tool", async () => {
  let executed = false;
  const model = {
    async generate({ messages }) {
      if (!messages.some((message) => message.role === "tool")) {
        return { text: "", toolCalls: [{ id: "call-invalid", name: "lookup_record", arguments: '{"key":17,"unexpected":true}' }] };
      }
      return { text: "The arguments were invalid.", toolCalls: [] };
    }
  };
  const result = await runToolAgent({
    model,
    messages: [{ role: "user", content: "Find alpha" }],
    tools: [{ ...echoTool, execute: async () => { executed = true; return "no"; } }],
    authorizeTool: async () => true
  });
  assert.equal(executed, false);
  assert.match(result.messages.find((message) => message.role === "tool").content, /TOOL_SCHEMA_INVALID/);
});

test("requires an explicit authorization policy and bounds model steps", async () => {
  const model = { async generate() { return { text: "done", toolCalls: [] }; } };
  await assert.rejects(
    runToolAgent({ model, messages: [{ role: "user", content: "Hi" }], tools: [] }),
    /authorizeTool is required/
  );
  const loopingModel = {
    async generate() {
      return { text: "", toolCalls: [{ id: "loop-call", name: "lookup_record", arguments: '{"key":"x"}' }] };
    }
  };
  await assert.rejects(
    runToolAgent({
      model: loopingModel,
      messages: [{ role: "user", content: "loop" }],
      tools: [echoTool],
      authorizeTool: async () => true,
      maxSteps: 1
    }),
    (error) => error.code === "TOOL_AGENT_MAX_STEPS"
  );
});

test("rejects duplicate tools and unsupported schemas before model execution", async () => {
  const model = { async generate() { throw new Error("should not run"); } };
  await assert.rejects(
    runToolAgent({
      model,
      messages: [{ role: "user", content: "Hi" }],
      tools: [echoTool, echoTool],
      authorizeTool: async () => true
    }),
    /Duplicate tool name/
  );
  await assert.rejects(
    runToolAgent({
      model,
      messages: [{ role: "user", content: "Hi" }],
      tools: [{ ...echoTool, parameters: { type: "object", properties: { value: { type: "unsupported" } } } }],
      authorizeTool: async () => true
    }),
    /unsupported schema type/
  );
});
