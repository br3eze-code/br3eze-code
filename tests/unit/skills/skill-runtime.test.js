import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineSkill, defineTool, loadSkillsFrom } from '../../../src/runtime/skill.js';
import { Registry } from '../../../src/runtime/registry.js';
import { ui_record } from '../../../skills/ui_record.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('AgentOS skill runtime', () => {
  let tempRoot;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-skills-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test('defines validated generic skills and tools', () => {
    const tool = defineTool({
      name: 'files.inspect',
      description: 'Inspect files',
      handler: async () => ({ ok: true }),
    });
    const skill = defineSkill({
      name: 'files',
      description: 'File operations',
      tools: [tool],
      persona: 'You help users work with files.',
    });

    expect(skill).toMatchObject({
      name: 'files',
      description: 'File operations',
      persona: 'You help users work with files.',
      tools: [tool],
    });
    expect(() => defineTool({ name: 'broken' })).toThrow('defineTool requires');
    expect(() => defineSkill()).toThrow('defineSkill requires');
  });

  test('discovers CommonJS code skills and SKILL.md-only persona skills', async () => {
    const codeDir = path.join(tempRoot, 'calendar');
    const personaDir = path.join(tempRoot, 'research');
    await fs.mkdir(codeDir);
    await fs.mkdir(personaDir);
    await fs.writeFile(path.join(codeDir, 'index.js'), [
      "module.exports = {",
      "  name: 'calendar',",
      "  description: 'Calendar operations',",
      "  tools: [{ name: 'calendar.list', handler: async () => [] }]",
      "};",
    ].join('\n'));
    await fs.writeFile(path.join(personaDir, 'SKILL.md'), [
      '---',
      'name: research',
      'description: Evidence-led research',
      '---',
      '# Research',
      'Use cited sources and state uncertainty clearly.',
    ].join('\n'));

    const skills = loadSkillsFrom(tempRoot);
    expect(skills).toHaveLength(2);
    expect(skills.find((skill) => skill.name === 'calendar')).toMatchObject({
      description: 'Calendar operations',
    });
    expect(skills.find((skill) => skill.name === 'research')).toMatchObject({
      description: 'Evidence-led research',
      persona: expect.stringContaining('Use cited sources'),
    });
  });

  test('falls back to SKILL.md when a code skill cannot load', async () => {
    const brokenDir = path.join(tempRoot, 'broken-skill');
    await fs.mkdir(brokenDir);
    await fs.writeFile(path.join(brokenDir, 'index.js'), 'throw new Error("broken implementation");');
    await fs.writeFile(path.join(brokenDir, 'SKILL.md'), [
      '---',
      'name: safe-fallback',
      'description: Safe fallback skill',
      '---',
      'Fallback persona.',
    ].join('\n'));

    expect(loadSkillsFrom(tempRoot)).toEqual([
      expect.objectContaining({ name: 'safe-fallback', description: 'Safe fallback skill' }),
    ]);
  });

  test('registers arbitrary skills, rejects duplicates, and exposes safe declarations', async () => {
    const registry = new Registry();
    const skill = defineSkill({
      name: 'math',
      tools: [defineTool({
        name: 'math.add',
        description: 'Add values',
        parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
        handler: async ({ a, b }) => a + b,
      })],
      match: (input) => input === 'add' ? { tool: 'math.add', args: { a: 2, b: 3 } } : null,
    });

    registry.registerSkill(skill);
    expect(registry.matchFastPath('add')).toEqual({ tool: 'math.add', args: { a: 2, b: 3 } });
    expect(registry.matchFastPath('unknown')).toBeNull();
    expect(registry.toolDeclarations()).toEqual([
      expect.objectContaining({ name: 'math.add', description: 'Add values' }),
    ]);
    expect(() => registry.registerSkill(skill)).toThrow('already registered');
    expect(() => registry.registerTool({ name: 'math.add', handler: async () => 0 }))
      .toThrow('already registered');
  });

  test('UI skills expose browser-neutral contracts rather than React-specific assumptions', async () => {
    const uiAgentSource = await fs.readFile(path.join(repoRoot, 'skills/ui_agent.js'), 'utf8');
    expect(ui_record).toMatchObject({
      name: 'ui_record',
      parameters: expect.objectContaining({ required: ['url'] }),
      run: expect.any(Function),
    });
    expect(uiAgentSource).toContain('name: "ui_agent"');
    expect(uiAgentSource).toContain('type: { type: "string", enum: ["goto", "click", "type", "wait", "select", "screenshot", "extract"] }');
    expect(uiAgentSource).not.toMatch(/from ['\"]react|ReactDOM|createRoot/);
  });

  test('runtime core remains independent of domain implementations', async () => {
    const runtimeSource = await fs.readFile(path.join(repoRoot, 'src/runtime/runtime.js'), 'utf8');
    const executable = runtimeSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(executable).not.toMatch(/mikrotik|hotspot|powerconnect|voucher|firebase/i);
  });
});
