import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fineTunePretrainedCli } from "./finetune-pretrained.js";

test("pretrained fine-tune CLI requires an input dataset", async () => {
  await assert.rejects(fineTunePretrainedCli([]), /--input is required/);
});

test("pretrained fine-tune CLI rejects malformed JSONL before spawning Python", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-js-pretrained-"));
  const input = join(directory, "invalid.jsonl");
  try {
    await writeFile(input, '{"prompt":"valid shape","completion":"one"}\nnot-json\n', "utf8");
    await assert.rejects(
      fineTunePretrainedCli(["--input", input, "--model", "example/model"]),
      /Invalid JSON on dataset line 2/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pretrained fine-tune CLI rejects unsupported record shapes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-js-pretrained-"));
  const input = join(directory, "invalid-shape.jsonl");
  try {
    await writeFile(input, '{"hello":"world"}\n{"hello":"again"}\n', "utf8");
    await assert.rejects(
      fineTunePretrainedCli(["--input", input, "--model", "example/model"]),
      /needs messages\[\], text, or prompt \+ completion/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
