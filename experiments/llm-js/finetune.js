#!/usr/bin/env node
import { readFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}

function positiveInteger(args, name, fallback, max = 1_000_000) {
  const value = Number(option(args, name, String(fallback)));
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${name} must be an integer from 1 to ${max}`);
  }
  return value;
}

export async function fineTuneCli(args = process.argv.slice(2)) {
  const input = option(args, "--input", null);
  const model = option(args, "--model", null);
  const output = option(args, "--output", "artifacts/lora-adapter");
  const python = option(args, "--python", process.env.PYTHON || "python");
  const maxLength = positiveInteger(args, "--max-length", 512, 8192);
  const steps = positiveInteger(args, "--steps", 100, 1_000_000);
  const batchSize = positiveInteger(args, "--batch-size", 1, 128);
  const gradAccum = positiveInteger(args, "--grad-accum", 4, 1024);
  const rank = positiveInteger(args, "--rank", 8, 256);
  const learningRate = Number(option(args, "--lr", "0.0002"));

  if (!input) throw new Error("--input is required (JSONL instruction/conversation dataset)");
  if (!model) throw new Error("--model is required (a Hugging Face model ID or local model directory)");
  if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 0.1) {
    throw new Error("--lr must be > 0 and <= 0.1");
  }
  await access(resolve(input));
  const rows = (await readFile(resolve(input), "utf8")).split(/\r?\n/).filter((line) => line.trim());
  if (rows.length < 2) throw new Error("Dataset must contain at least 2 non-empty JSONL records");
  rows.forEach((line, index) => {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(`Invalid JSON on dataset line ${index + 1}`); }
    const validMessages = Array.isArray(row.messages) && row.messages.length > 0 &&
      row.messages.every((m) => m && typeof m.role === "string" && typeof m.content === "string");
    const validText = typeof row.text === "string" && row.text.trim().length > 0;
    const validPair = typeof row.prompt === "string" && typeof row.completion === "string";
    if (!validMessages && !validText && !validPair) {
      throw new Error(`Dataset line ${index + 1} needs messages[], text, or prompt + completion`);
    }
  });

  const scriptPath = fileURLToPath(new URL("./finetune_peft.py", import.meta.url));
  const childArgs = [
    scriptPath, "--input", resolve(input), "--model", model, "--output", resolve(output),
    "--max-length", String(maxLength), "--steps", String(steps), "--batch-size", String(batchSize),
    "--grad-accum", String(gradAccum), "--rank", String(rank), "--lr", String(learningRate)
  ];
  process.stdout.write(`Fine-tuning pretrained model: ${model}\nDataset records: ${rows.length}\nAdapter output: ${resolve(output)}\n`);
  process.stdout.write("This trains LoRA adapter weights; it does not train a new base model.\n");
  await new Promise((resolvePromise, reject) => {
    const child = spawn(python, childArgs, { stdio: "inherit", env: process.env });
    child.once("error", (error) => reject(new Error(`Could not start Python backend (${python}): ${error.message}`)));
    child.once("close", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Fine-tuning backend exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  fineTuneCli().catch((error) => {
    console.error(`llm-js fine-tune: ${error.message}`);
    process.exitCode = 1;
  });
}
