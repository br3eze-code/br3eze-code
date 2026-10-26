import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fineTuneCli } from "./finetune.js";

test("fine-tune CLI requires an input dataset", async () => {
  await assert.rejects(fineTuneCli([]), /--input is required/);
});

test("fine-tune CLI rejects malformed JSONL before starting a backend", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-js-finetune-"));
  const input = join(directory, "invalid.jsonl");
  try {
    await writeFile(input, '{"prompt":"valid shape","completion":"one"}\nnot-json\n', "utf8");
    await assert.rejects(
      fineTuneCli(["--input", input, "--model", "not-downloaded/test-model"]),
      /Invalid JSON on dataset line 2/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fine-tune CLI rejects unsupported dataset rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "llm-js-finetune-"));
  const input = join(directory, "invalid-shape.jsonl");
  try {
    await writeFile(input, '{"hello":"world"}\n{"hello":"again"}\n', "utf8");
    await assert.rejects(
      fineTuneCli(["--input", input, "--model", "not-downloaded/test-model"]),
      /needs messages\[\], text, or prompt \+ completion/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
