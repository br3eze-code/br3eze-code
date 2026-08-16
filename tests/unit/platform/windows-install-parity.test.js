import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const installer = fs.readFileSync(path.join(root, 'scripts/agentos-postinstall.mjs'), 'utf8');
const adapter = fs.readFileSync(path.join(root, 'src/platform/windows-shell.js'), 'utf8');

describe('Windows user-local and audit parity', () => {
  test('installer uses npm-derived user paths and PowerShell user environment scope', () => {
    expect(installer).toContain("['config', 'get', 'prefix']");
    expect(installer).toContain('[Environment]::GetEnvironmentVariable("Path", "User")');
    expect(installer).toContain('[Environment]::SetEnvironmentVariable');
    expect(installer).toContain('-NoProfile');
    expect(installer).toContain('-NonInteractive');
    expect(installer).not.toMatch(/STARLINK_CLIENT_SECRET|PAYNOW_INTEGRATION_KEY|ECOCASH_MERCHANT_PIN|OPENAI_API_KEY/);
  });

  test('adapter execution is shell-free and carries the common audit scope', () => {
    expect(adapter).toContain("shell: false");
    expect(adapter).toContain('userId');
    expect(adapter).toContain('tenantId');
    expect(adapter).toContain('domain');
    expect(adapter).toContain('siteId');
    expect(adapter).toContain('auditSink');
    expect(adapter).toContain('approval');
  });

  test('installer does not write secrets into profile or PATH configuration', () => {
    expect(installer).not.toMatch(/process\.env\.(?:[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD|PIN|PRIVATE_KEY)[A-Z0-9_]*)/);
    expect(installer).not.toMatch(/SetEnvironmentVariable\([^,]+,\s*process\.env\./s);
  });
});
