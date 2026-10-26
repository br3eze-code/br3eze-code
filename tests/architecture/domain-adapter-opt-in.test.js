import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { ToolRegistry } from '../../src/core/tool-registry.js';
import loadAllDomains from '../../src/core/loadDomain.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('optional domain adapter boot boundary', () => {
  test('autonomous audit changes require a review PR and explicit CI dispatch', () => {
    const workflow = read('../../.github/workflows/autonomous-audit.yml');
    expect(workflow).not.toContain('git push origin main');
    expect(workflow).toContain('gh pr create --base main');
    expect(workflow).toContain('gh workflow run ci.yml --ref "$BRANCH"');
  });

  test('package entry points to the canonical runtime, not the removed gateway facade', () => {
    const packageJson = JSON.parse(read('../../package.json'));
    expect(packageJson.main).toBe('src/core/agentRuntime.js');
    expect(() => read('../../src/core/agentRuntime.js')).not.toThrow();
  });

  test('host bootstrap does not statically import or register RouterOS by default', () => {
    const source = read('../../src/host/bootstrap.js');
    expect(source).not.toContain("import * as networkAdapter from '../adapters/network/mikrotik.js'");
    expect(source).not.toContain("import { registerNetworkProvider } from '../core/mikrotik.js'");
    expect(source).toContain("NETWORK_DOMAINS.has(ACTIVE_DOMAIN)");
    expect(source).toContain("import('../adapters/network/mikrotik.js')");
  });

  test('an explicitly selected domain excludes unrelated domain adapters', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false });
    await loadAllDomains({ domain: '__no_domain__' }, registry);
    expect(registry.domains.size).toBe(0);
  });

  test('CLI only loads network command modules for a network domain', () => {
    const source = read('../../main.js');
    expect(source).not.toContain("import _cmd_mikrotik from './src/cli/commands/mikrotik.js'");
    expect(source).toContain('async function registerOptionalDomainCommands()');
    expect(source).toContain("if (!['network', 'wifi', 'wifi-billing'].includes(domain)) return;");
  });

  test('gateway only loads and connects RouterOS for a network domain', () => {
    const source = read('../../src/cli/commands/gateway.js');
    expect(source).not.toContain("import { getManager as getMikroTik } from '../../core/mikrotik.js'");
    expect(source).toContain("import('../../core/mikrotik.js')");
    expect(source).toContain('if (networkEnabled && mikrotik)');
  });
});
