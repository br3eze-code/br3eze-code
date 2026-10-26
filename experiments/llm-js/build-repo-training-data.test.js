import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildTrainingRecords, writeTrainingCorpus } from "./build-repo-training-data.mjs";

test("corpus builder includes source and documentation, excludes secret files and generated folders", async () => {
  const root = await mkdtemp(join(tmpdir(), "br3eze-corpus-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "bad-package"), { recursive: true });
    await writeFile(join(root, "README.md"), "# AgentOS\nA general purpose agent harness.\n");
    await writeFile(join(root, "src", "runtime.js"), "export function run() { return 'safe'; }\n");
    await writeFile(join(root, ".env"), "API_KEY=do-not-train-this-secret\n");
    await writeFile(join(root, "serviceAccountKey.json"), JSON.stringify({ private_key: "-----BEGIN PRIVATE KEY-----\\nprivate-material\\n-----END PRIVATE KEY-----" }));
    await writeFile(join(root, "credentials.json"), JSON.stringify({ token: "do-not-train-this-token" }));
    await writeFile(join(root, "node_modules", "bad-package", "index.js"), "should not appear");
    const records = await buildTrainingRecords(root);
    const joined = records.map((record) => record.text).join("\n");
    assert.match(joined, /README\.md/);
    assert.match(joined, /src\/runtime\.js/);
    assert.doesNotMatch(joined, /do-not-train-this-secret|should not appear|private-material|do-not-train-this-token|serviceAccountKey\.json|credentials\.json/);
    assert.ok(records.length >= 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corpus builder redacts credential-shaped assignments and writes both dataset formats", async () => {
  const root = await mkdtemp(join(tmpdir(), "br3eze-corpus-output-"));
  try {
    await writeFile(join(root, "a.js"), "const apiKey = 'ghp_123456789012345678901234567890';\n");
    await writeFile(join(root, "b.md"), "# Notes\nSafe documentation.\n");
    const report = await writeTrainingCorpus({ root, outDir: "generated" });
    const jsonl = await readFile(join(root, "generated", "br3eze-repo.jsonl"), "utf8");
    const plain = await readFile(join(root, "generated", "br3eze-repo.txt"), "utf8");
    assert.equal(jsonl.trim().split("\n").length, report.records);
    assert.doesNotMatch(jsonl, /ghp_123456789012345678901234567890/);
    assert.match(plain, /Safe documentation/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
