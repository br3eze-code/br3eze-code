#!/usr/bin/env node
/**
 * Live smoke test for a running OpenAI-compatible open-model endpoint.
 * This deliberately does not download weights or start a model server.
 */
import { createOpenAICompatibleAdapter } from "./harness.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : fallback;
}

export async function smokeOpenModel(args = process.argv.slice(2)) {
  const baseUrl = readOption(args, "--base-url", process.env.MODEL_BASE_URL ?? "http://127.0.0.1:8080/v1");
  const model = readOption(args, "--model", process.env.MODEL_ID ?? "local-model");
  const prompt = readOption(args, "--prompt", "Reply with one short sentence confirming you are ready.");
  const maxTokens = Number(readOption(args, "--max-tokens", "64"));
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) {
    throw new RangeError("--max-tokens must be an integer from 1 to 4096");
  }

  const adapter = createOpenAICompatibleAdapter({
    baseUrl,
    model,
    apiKey: process.env.MODEL_API_KEY,
    timeoutMs: Number(readOption(args, "--timeout-ms", "30000"))
  });
  const startedAt = Date.now();
  const result = await adapter.generate({
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    maxTokens
  });
  console.log(JSON.stringify({
    ok: true,
    endpoint: adapter.baseUrl,
    requestedModel: model,
    servedModel: result.model,
    elapsedMs: Date.now() - startedAt,
    usage: result.usage,
    text: result.text
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  smokeOpenModel().catch((error) => {
    console.error(`open-model smoke test failed: ${error.message}`);
    process.exitCode = 1;
  });
}
