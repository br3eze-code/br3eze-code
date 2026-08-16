import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRuntime } from '../../../src/runtime/runtime.js';
import { obsidianSkill } from '../../../src/skills/obsidian/index.js';
import { ObsidianVaultAdapter } from '../../../src/integrations/obsidian.js';

describe('domain-neutral Obsidian skill', () => {
  let root;
  let adapter;
  let events;
  const baseContext = {
    userId: 'agent-user',
    scope: { tenantId: 'tenant-a', domain: 'workspace', siteId: 'site-7' }
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-obsidian-skill-'));
    events = [];
    adapter = new ObsidianVaultAdapter({ vaultRoot: root, audit: async (event) => events.push(event) });
  });

  afterEach(async () => fs.rm(root, { recursive: true, force: true }));

  test('registers generic workspace tools without product-domain names', () => {
    expect(obsidianSkill.name).toBe('workspace.obsidian');
    expect(obsidianSkill.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'workspace.obsidian.status',
      'workspace.obsidian.read_note',
      'workspace.obsidian.graph_context',
      'workspace.obsidian.write_note',
      'workspace.obsidian.create_note'
    ]));
    expect(obsidianSkill.description).not.toMatch(/shopping|cctv|mikrotik|starlink/i);
  });

  test('runs through the domain-agnostic runtime and preserves scope', async () => {
    await adapter.writeNote('context.md', '[[Next]] #agent', { ...baseContext, approval: { approved: true } });
    const runtime = createRuntime().use(obsidianSkill);
    const result = await runtime.run('note graph context.md', { ...baseContext, obsidianAdapter: adapter });
    expect(result).toMatchObject({ type: 'tool', tool: 'workspace.obsidian.graph_context' });
    expect(result.result).toMatchObject({ path: 'context.md', links: ['Next'], tags: ['#agent'] });
    expect(events.at(-1)).toMatchObject({ action: 'obsidian.read', userId: 'agent-user', tenantId: 'tenant-a', domain: 'workspace', siteId: 'site-7' });
  });

  test('requires approval for agent mutations', async () => {
    const runtime = createRuntime().use(obsidianSkill);
    const result = await runtime._invoke('workspace.obsidian.write_note', { path: 'new.md', content: 'x' }, { ...baseContext, obsidianAdapter: adapter });
    expect(result.type).toBe('error');
    await expect(runtime._invoke('workspace.obsidian.write_note', { path: 'new.md', content: 'x' }, { ...baseContext, obsidianAdapter: adapter }))
      .resolves.toMatchObject({ type: 'error', result: expect.stringMatching(/approved/) });
  });

  test('supports injected adapters without environment or hardcoded vault paths', async () => {
    const runtime = createRuntime().use(obsidianSkill);
    const result = await runtime._invoke('workspace.obsidian.status', {}, { ...baseContext, obsidianAdapter: adapter });
    expect(result).toMatchObject({ type: 'tool', result: { available: true, scope: baseContext.scope } });
  });
});
