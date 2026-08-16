import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'www');
const targets = [
  path.join(repoRoot, 'platforms', 'browser', 'www'),
  path.join(repoRoot, 'platforms', 'android', 'app', 'src', 'main', 'assets', 'www')
];
const manifestName = '.agentos-php-manifest.json';
const checkOnly = process.argv.includes('--check');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function phpFiles(dir, relative = '') {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relativePath = path.join(relative, entry.name);
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...phpFiles(absolutePath, relativePath));
    else if (entry.isFile() && entry.name.endsWith('.php')) files.push(relativePath);
  }
  return files.sort();
}

const files = phpFiles(sourceDir);
if (files.length === 0) throw new Error('No PHP source files found under www/.');
const manifest = {
  source: 'www',
  generatedBy: 'scripts/sync-php-platforms.mjs',
  files: Object.fromEntries(files.map((name) => [name, sha256(path.join(sourceDir, name))]))
};

let drift = false;
for (const target of targets) {
  if (checkOnly && !fs.existsSync(target)) {
    console.error(`[AgentOS] Missing PHP target: ${path.relative(repoRoot, target)}`);
    drift = true;
    continue;
  }
  fs.mkdirSync(target, { recursive: true });
  const previous = path.join(target, manifestName);
  let oldManifest = { files: {} };
  if (fs.existsSync(previous)) {
    try { oldManifest = JSON.parse(fs.readFileSync(previous, 'utf8')); } catch { oldManifest = { files: {} }; }
  }

  for (const stale of Object.keys(oldManifest.files)) {
    if (!manifest.files[stale]) {
      const stalePath = path.join(target, stale);
      if (checkOnly && fs.existsSync(stalePath)) {
        console.error(`[AgentOS] Stale PHP file: ${path.relative(repoRoot, stalePath)}`);
        drift = true;
      } else if (fs.existsSync(stalePath)) {
        fs.rmSync(stalePath);
        const parent = path.dirname(stalePath);
        if (parent !== target && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmSync(parent, { recursive: true });
      }
    }
  }
  for (const name of files) {
    const source = path.join(sourceDir, name);
    const destination = path.join(target, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (checkOnly) {
      if (!fs.existsSync(destination) || sha256(destination) !== manifest.files[name]) {
        console.error(`[AgentOS] PHP drift: ${path.relative(repoRoot, destination)}`);
        drift = true;
      }
    } else {
      fs.copyFileSync(source, destination);
    }
  }
  if (!checkOnly) {
    fs.writeFileSync(previous, `${JSON.stringify(manifest, null, 2)}\\n`);
    console.log(`[AgentOS] Synchronized ${files.length} PHP files into ${path.relative(repoRoot, target)}`);
  }
}
if (checkOnly && drift) process.exit(1);
if (checkOnly) console.log(`[AgentOS] PHP parity verified for ${files.length} files across ${targets.length} targets.`);
