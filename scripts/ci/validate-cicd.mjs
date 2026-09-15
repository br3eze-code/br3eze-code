import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');
const errors = [];

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!fs.existsSync(path.join(root, 'package-lock.json'))) {
  errors.push('Missing required lockfile: package-lock.json');
}

// server/package.json is a legacy/standalone deployment manifest. It is not
// installed by the root CI pipeline, so do not make a non-existent server lock
// a prerequisite for validating the root project. If a server lockfile is
// introduced later, its workflow must use npm ci against that lockfile.

if (packageJson.engines?.node !== '>=22.0.0') {
  errors.push(`package.json must declare Node >=22.0.0; found ${packageJson.engines?.node ?? 'missing'}`);
}

const workflows = fs.readdirSync(workflowDir).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));
for (const file of workflows) {
  const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');

  if (/node-version:\s*['"]?(?:18|20|21)(?:\.x)?['"]?/i.test(text)) {
    errors.push(`${file}: Node 18/20/21 is forbidden; use Node 22`);
  }

  for (const match of text.matchAll(/npm\s+ci\b[^\n]*/g)) {
    if (!match[0].includes('--ignore-scripts')) {
      errors.push(`${file}: npm ci must include --ignore-scripts`);
    }
  }

  // Only flag npm install when it is an actual workflow `run:` command.
  // Documentation/changelog examples such as `echo "npm install ..."` are not
  // dependency installation steps and must not fail the contract.
  for (const match of text.matchAll(/(?:^|\n)\s*run:\s*npm\s+install\b[^\n]*/g)) {
    const command = match[0];
    const allowed = command.includes('--package-lock-only') || command.includes(' -g ') || command.includes(' --global ');
    if (!allowed) {
      errors.push(`${file}: dependency installs must use npm ci; found ${command.trim()}`);
    }
  }

  if (/npm\s+(?:test|run\s+lint|run\s+build)[^\n]*\|\|\s*true/.test(text)) {
    errors.push(`${file}: CI quality commands may not be masked with || true`);
  }
}

if (errors.length) {
  console.error('CI/CD synchronization contract FAILED:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`CI/CD synchronization contract passed for ${workflows.length} workflow files.`);
console.log('Node: 22');
console.log('Package manager: npm');
console.log('Root lockfile: required');
console.log('Server lockfile: optional legacy manifest');
console.log('Main-only release/deployment policy: enforced by workflow definitions');
