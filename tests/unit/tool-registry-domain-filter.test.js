import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '../../src/core/tool-registry.js';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ToolRegistry domain skill exclusions', () => {
  test('does not load excluded domain skills while retaining general skills', async () => {
    const skillsPath = mkdtempSync(path.join(os.tmpdir(), 'agentos-skills-'));
    temporaryDirectories.push(skillsPath);
    for (const skill of ['general', 'mikrotik', 'voucher']) {
      const skillPath = path.join(skillsPath, skill);
      mkdirSync(skillPath);
      writeFileSync(path.join(skillPath, 'manifest.yaml'), `name: ${skill}\nversion: 1.0.0\ntools: []\n`);
    }

    const registry = new ToolRegistry({
      skillsPath,
      excludedSkills: ['MikroTik', 'voucher'],
      logger: { info() {}, warn() {}, error() {} },
    });

    await registry.loadSkills();

    expect(registry.skills.has('general')).toBe(true);
    expect(registry.skills.has('mikrotik')).toBe(false);
    expect(registry.skills.has('voucher')).toBe(false);
    expect(await registry.loadSkill('mikrotik')).toBe(false);
  });
});
