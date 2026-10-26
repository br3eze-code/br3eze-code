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

describe('ToolRegistry in-memory skill registration', () => {
  test('registers a validated skill in the canonical registry and unloads it cleanly', async () => {
    const registry = new ToolRegistry({ requireExecutionTask: false, logger: { info() {}, warn() {}, error() {} } });
    registry.registerSkill({
      name: 'ephemeral',
      description: 'in-memory test skill',
      tools: [{ name: 'echo', description: 'echo input', execute: async (args) => args }],
    });
    expect(registry.tools.has('ephemeral.echo')).toBe(true);
    expect(registry.skills.get('ephemeral').inMemory).toBe(true);
    await expect(registry.unloadSkill('ephemeral')).resolves.toBe(true);
    expect(registry.tools.has('ephemeral.echo')).toBe(false);
  });

  test('rejects duplicate tools atomically', () => {
    const registry = new ToolRegistry({ logger: { info() {}, warn() {}, error() {} } });
    expect(() => registry.registerSkill({
      name: 'invalid',
      tools: [
        { name: 'same', execute: async () => 'first' },
        { name: 'same', execute: async () => 'second' },
      ],
    })).toThrow(/already registered/);
    expect(registry.skills.has('invalid')).toBe(false);
    expect(registry.tools.has('invalid.same')).toBe(false);
  });
});
