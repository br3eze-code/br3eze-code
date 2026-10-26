import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewaySource = fs.readFileSync(
  path.resolve(here, '../../src/cli/commands/gateway.js'),
  'utf8',
);

describe('single-runtime gateway composition contract', () => {
  test('composes the canonical runtime through the singleton accessor', () => {
    expect(gatewaySource).toMatch(/import\s*\{\s*getAgentRuntime\s*\}\s*from\s*['"]\.\.\/\.\.\/core\/agentRuntime\.js['"]/);
    expect(gatewaySource).toMatch(/const\s+runtime\s*=\s*getAgentRuntime\s*\(/);
    expect(gatewaySource).not.toMatch(/new\s+AgentRuntime\s*\(/);
  });

  test('legacy askEngine names remain aliases, not a second engine', () => {
    expect(gatewaySource).toMatch(/global\.agentRuntime\s*=\s*runtime\s*;/);
    expect(gatewaySource).toMatch(/global\.askEngine\s*=\s*runtime\s*;/);
    expect(gatewaySource).toMatch(/gateway\.runtime\s*=\s*runtime\s*;/);
    expect(gatewaySource).toMatch(/gateway\.askEngine\s*=\s*runtime\s*;/);
  });

  test('scheduled tasks receive the same canonical runtime instance', () => {
    expect(gatewaySource).toMatch(/new\s+TaskScheduler\s*\(\s*\{\s*engine\s*:\s*runtime\s*\}\s*\)/);
  });
});
