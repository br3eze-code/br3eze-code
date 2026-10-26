#!/usr/bin/env node
// Build a reproducible, secret-aware training corpus from this repository.
// Generated corpora/checkpoints are artifacts and must not be committed.
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([".js",".mjs",".cjs",".ts",".tsx",".jsx",".json",".md",".mdx",".txt",".yaml",".yml",".toml",".sql",".html",".css",".sh",".py",".php",".rsc"]);
const EXCLUDED_DIRS = new Set([".git","node_modules","vendor","dist","build","coverage","release","artifacts",".next",".vercel",".turbo","playwright-report","test-results","logs","scratch","tmp"]);
const EXCLUDED_FILES = /(^|\/)(\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore|jks|sqlite|db|log|lock|map|min\.js|wasm|zip|gz|pdf|png|jpe?g|gif|webp|ico|woff2?|ttf|otf))$/i;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CHUNK_CHARS = 6000;

function redactSecrets(text) {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|authorization)\s*[:=]\s*)(["']?)[^\s"' ,;}{]+\2/gi, "$1[REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})\b/g, "[REDACTED_TOKEN]");
}

function eligiblePath(path) {
  const normalized = path.split(sep).join("/");
  if (EXCLUDED_FILES.test(normalized)) return false;
  // Exclude service-account/credential JSON by filename, including camelCase variants.
  if (/(^|\/)(?:serviceAccountKey|service-account|firebase-service-account|firebase-adminsdk|credentials?)(?:[^/]*?)\.json$/i.test(normalized)) return false;
  if (normalized.split("/").some((part) => part.startsWith(".") && part !== ".github")) return false;
  if (normalized.split("/").some((part) => EXCLUDED_DIRS.has(part))) return false;
  if (/(^|\/)(?:secrets?|credentials?|service-account|firebase-adminsdk)(?:\/|[-_.])/i.test(normalized)) return false;
  return TEXT_EXTENSIONS.has(extname(normalized).toLowerCase());
}

async function walk(root, directory = root, result = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name) && !(entry.name.startsWith(".") && entry.name !== ".github")) await walk(root, absolute, result);
    } else if (entry.isFile() && eligiblePath(path)) {
      result.push({ absolute, path });
    }
  }
  return result;
}

function splitIntoChunks(text, maxChars = MAX_CHUNK_CHARS) {
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    const next = current ? current + "\n" + line : line;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else current = next;
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

export async function buildTrainingRecords(root = process.cwd()) {
  root = resolve(root);
  const files = await walk(root);
  const records = [];
  for (const file of files) {
    const metadata = await stat(file.absolute);
    if (metadata.size === 0 || metadata.size > MAX_FILE_BYTES) continue;
    let source;
    try { source = await readFile(file.absolute, "utf8"); } catch { continue; }
    if (source.includes("\u0000")) continue;
    const safeSource = redactSecrets(source).replace(/\r\n/g, "\n").trim();
    if (!safeSource) continue;
    for (const [index, chunk] of splitIntoChunks(safeSource).entries()) {
      records.push({ text: `Repository file: ${file.path}\nChunk: ${index + 1}\n\n${chunk}`, source: file.path, chunk: index + 1 });
    }
  }
  if (records.length < 2) throw new Error(`Expected at least 2 training chunks; found ${records.length}. Run from the repository root.`);
  return records;
}

export async function writeTrainingCorpus({ root = process.cwd(), outDir = "artifacts/training-data" } = {}) {
  const records = await buildTrainingRecords(root);
  const outputDirectory = resolve(root, outDir);
  await mkdir(outputDirectory, { recursive: true });
  const jsonlPath = join(outputDirectory, "br3eze-repo.jsonl");
  const textPath = join(outputDirectory, "br3eze-repo.txt");
  await writeFile(jsonlPath, records.map(({ text }) => JSON.stringify({ text })).join("\n") + "\n", "utf8");
  await writeFile(textPath, records.map(({ text }) => text).join("\n\n---\n\n") + "\n", "utf8");
  const report = { records: records.length, uniqueFiles: new Set(records.map((record) => record.source)).size, characters: records.reduce((sum, record) => sum + record.text.length, 0), jsonlPath, textPath };
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const valueAfter = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
  };
  writeTrainingCorpus({ root: process.cwd(), outDir: valueAfter("--out-dir", "artifacts/training-data") }).catch((error) => {
    console.error(`repo-corpus: ${error.message}`);
    process.exitCode = 1;
  });
}
