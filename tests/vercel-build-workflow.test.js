import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Vercel build workflow', () => {
  test('vercel build script is present and produces required deploy files', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts?.['vercel:build']).toBeDefined();
    expect(fs.existsSync(path.join(root, 'www', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'api', 'index.js'))).toBe(true);
  });

  test('vercel configuration uses the verified build and Node 22', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    expect(vercel.buildCommand).toBe('npm run vercel:build');
    expect(vercel.installCommand).toContain('npm install');
    expect(pkg.engines?.node).toMatch(/22/);
  });

  test('syntax/build verification command passes', () => {
    expect(() => execFileSync(process.execPath, ['scripts/check-syntax.mjs'], {
      cwd: root,
      stdio: 'pipe',
      timeout: 30000,
    })).not.toThrow();
  });
});
