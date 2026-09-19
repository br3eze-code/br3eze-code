import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), '.github/workflows')
const files = fs.readdirSync(root).filter((name) => /\.(?:yml|yaml)$/.test(name))
const errors = []
const supportedActions = new Map([
  ['actions/checkout', /^v[34]$/],
  ['actions/setup-node', /^v[34]$/],
  ['actions/upload-artifact', /^v[34]$/],
  ['docker/setup-buildx-action', /^v[34]$/],
  ['docker/login-action', /^v[34]$/],
  ['docker/metadata-action', /^v[56]$/],
  ['docker/build-push-action', /^v[6]$/],
])

for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  if (/^\s*uses:\s*(?:missing|undefined|null)\s*$/m.test(source)) errors.push(`${file}: invalid uses reference`)
  for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm)) {
    const [owner, ref] = match[1].split('@')
    const expected = supportedActions.get(owner)
    if (expected && !expected.test(ref)) errors.push(`${file}: unsupported ${match[1]}`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`Workflow contract passed: ${files.length} workflow files scanned`)
