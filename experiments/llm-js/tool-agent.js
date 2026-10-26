/**
 * Domain-neutral tool-calling loop inspired by Formula Chat's agent pattern.
 *
 * Models propose tool calls; this runner validates names/arguments and requires
 * an application-supplied authorization policy before executing any tool.
 * Data-source implementations (SQL, search, APIs, files) stay outside this file.
 */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateValue(value, schema, path = "$") {
  const errors = [];
  if (!schema || typeof schema !== "object") return errors;
  switch (schema.type) {
    case "object":
      if (!isPlainObject(value)) return [`${path} must be an object`];
      for (const key of schema.required ?? []) {
        if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (Object.hasOwn(value, key)) errors.push(...validateValue(value[key], child, `${path}.${key}`));
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(schema.properties ?? {}, key)) errors.push(`${path}.${key} is not allowed`);
        }
      }
      break;
    case "array":
      if (!Array.isArray(value)) return [`${path} must be an array`];
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items`);
      if (schema.items) value.forEach((item, index) => errors.push(...validateValue(item, schema.items, `${path}[${index}]`)));
      break;
    case "string":
      if (typeof value !== "string") return [`${path} must be a string`];
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a finite number`];
      break;
    case "integer":
      if (!Number.isInteger(value)) return [`${path} must be an integer`];
      break;
    case "boolean":
      if (typeof value !== "boolean") return [`${path} must be a boolean`];
      break;
    default:
      return [`${path} has unsupported schema type: ${schema.type}`];
  }
  if (schema.enum && !schema.enum.some((entry) => Object.is(entry, value))) errors.push(`${path} is not an allowed value`);
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
  if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  return errors;
}

function toToolResult(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value ?? null); }
  catch { throw new TypeError("Tool result must be JSON-serializable or a string"); }
}

function normalizeTool(tool) {
  if (!tool || typeof tool.name !== "string" || !tool.name.trim()) throw new TypeError("Each tool needs a non-empty name");
  if (typeof tool.execute !== "function") throw new TypeError(`Tool ${tool.name} must implement execute(args, context)`);
  if (!isPlainObject(tool.parameters) || tool.parameters.type !== "object") {
    throw new TypeError(`Tool ${tool.name} must provide an object JSON Schema in parameters`);
  }
  return tool;
}

export async function runToolAgent({
  model,
  messages,
  tools,
  authorizeTool,
  context = {},
  signal,
  maxSteps = 6,
  maxTokens = 1024,
  temperature = 0.2,
  onEvent = () => {}
} = {}) {
  if (!model || typeof model.generate !== "function") throw new TypeError("model must implement generate()");
  if (!Array.isArray(messages) || messages.length === 0) throw new TypeError("messages must be a non-empty array");
  if (!Array.isArray(tools)) throw new TypeError("tools must be an array");
  if (typeof authorizeTool !== "function") throw new TypeError("authorizeTool is required; tool execution must be explicitly authorized");
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 32) throw new RangeError("maxSteps must be an integer from 1 to 32");
  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function");

  const toolMap = new Map();
  for (const raw of tools) {
    const tool = normalizeTool(raw);
    if (toolMap.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    toolMap.set(tool.name, tool);
  }
  const publicTools = [...toolMap.values()].map(({ name, description = "", parameters }) => ({
    type: "function",
    function: { name, description, parameters }
  }));
  const conversation = messages.map((message) => ({ ...message }));
  const emit = (type, details = {}) => onEvent(Object.freeze({ type, ...details }));

  for (let step = 1; step <= maxSteps; step += 1) {
    if (signal?.aborted) throw signal.reason ?? new Error("Tool-agent run aborted");
    const completion = await model.generate({
      messages: conversation,
      tools: publicTools,
      toolChoice: publicTools.length ? "auto" : undefined,
      maxTokens,
      temperature,
      signal
    });
    const calls = Array.isArray(completion.toolCalls) ? completion.toolCalls : [];
    if (calls.length > 0 && step === maxSteps) {
      throw Object.assign(new Error(`Tool-agent reached maxSteps (${maxSteps}) before it could synthesize a final answer`), { code: "TOOL_AGENT_MAX_STEPS" });
    }
    if (calls.length === 0) {
      const answer = typeof completion.text === "string" ? completion.text : "";
      conversation.push({ role: "assistant", content: answer });
      emit("done", { step, answer, model: completion.model ?? null, usage: completion.usage ?? null });
      return { answer, messages: conversation, steps: step, model: completion.model ?? null, usage: completion.usage ?? null };
    }

    conversation.push({
      role: "assistant",
      content: completion.text ?? "",
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}) }
      }))
    });

    for (const call of calls) {
      const name = typeof call.name === "string" ? call.name : "";
      emit("tool_call", { step, toolName: name, callId: call.id ?? null });
      let result;
      try {
        const tool = toolMap.get(name);
        if (!tool) throw Object.assign(new Error("Model requested an unknown tool"), { code: "UNKNOWN_TOOL" });
        let args;
        try {
          args = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : (call.arguments ?? {});
        } catch {
          throw Object.assign(new Error("Tool arguments are not valid JSON"), { code: "INVALID_TOOL_ARGUMENTS" });
        }
        const validationErrors = validateValue(args, tool.parameters);
        if (validationErrors.length) {
          throw Object.assign(new Error(validationErrors.join("; ")), { code: "TOOL_SCHEMA_INVALID" });
        }
        const allowed = await authorizeTool({ tool: { name: tool.name, description: tool.description ?? "", risk: tool.risk ?? "low", permissions: tool.permissions ?? [] }, args, context, signal });
        if (allowed !== true) throw Object.assign(new Error("Tool execution was not authorized"), { code: "TOOL_NOT_AUTHORIZED" });
        result = await tool.execute(args, { ...context, signal, toolCallId: call.id, step });
        emit("tool_result", { step, toolName: name, callId: call.id ?? null, success: true });
      } catch (error) {
        // Return a bounded error to the model so it can recover; never bypass policy.
        result = { error: { code: error.code || "TOOL_EXECUTION_FAILED", message: String(error.message || error).slice(0, 500) } };
        emit("tool_result", { step, toolName: name || null, callId: call.id ?? null, success: false, code: error.code || "TOOL_EXECUTION_FAILED" });
      }
      conversation.push({
        role: "tool",
        tool_call_id: typeof call.id === "string" && call.id ? call.id : `tool-call-${step}-${conversation.length}`,
        name: name || "unknown",
        content: toToolResult(result)
      });
    }
  }
  throw Object.assign(new Error(`Tool-agent exceeded maximum of ${maxSteps} model steps`), { code: "TOOL_AGENT_MAX_STEPS" });
}
