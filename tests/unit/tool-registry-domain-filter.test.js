import { afterEach, describe, expect, test, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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
    mkdirSync(path.join(skillsPath, 'general'));
    mkdirSync(path.join(skillsPath, 'mikrotik'));
    mkdirSync(path.join(skillsPath, 'voucher'));

    const registry = new ToolRegistry({
      skillsPath,
      excludedSkills: ['MikroTik', 'voucher'],
      logger: { info() {}, warn() {}, error() {} },
    });
    const loadSkill = jest.spyOn(registry, 'loadSkill').mockResolvedValue(true);

    await registry.loadSkills();

    expect(loadSkill).toHaveBeenCalledTimes(1);
    expect(loadSkill).toHaveBeenCalledWith('general');
    expect(loadSkill).not.toHaveBeenCalledWith('mikrotik');
    expect(loadSkill).not.toHaveBeenCalledWith('voucher');
    loadSkill.mockRestore();
    expect(await registry.loadSkill('mikrotik')).toBe(false);
  });
});
