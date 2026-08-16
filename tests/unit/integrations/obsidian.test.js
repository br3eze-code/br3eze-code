import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ObsidianVaultAdapter, createObsidianUri, normalizeVaultPath, extractGraph } from '../../../src/integrations/obsidian.js';

describe('ObsidianVaultAdapter', () => {
  let root;
  let events;
  const context = { userId: 'user-1', scope: { tenantId: 'tenant-a', domain: 'notes', siteId: 'site-1' } };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-obsidian-'));
    events = [];
  });

  afterEach(async () => fs.rm(root, { recursive: true, force: true }));

  test('confines paths to the vault and normalizes separators', () => {
    expect(normalizeVaultPath('folder\\note.md')).toBe('folder/note.md');
    expect(() => normalizeVaultPath('../outside.md')).toThrow(/escapes/);
    expect(() => normalizeVaultPath('/outside.md')).toThrow(/relative/);
  });

  test('encodes supported Obsidian URIs', () => {
    expect(createObsidianUri('open', { vault: 'My Vault', file: 'Folder/My Note.md' }))
      .toBe('obsidian://open?vault=My+Vault&file=Folder%2FMy+Note.md');
    expect(() => createObsidianUri('shell', {})).toThrow(/unsupported/);
  });

  test('requires identity for reads and approved identity for writes', async () => {
    const adapter = new ObsidianVaultAdapter({ vaultRoot: root, audit: async (event) => events.push(event) });
    await expect(adapter.readNote('note.md', {})).rejects.toThrow(/identity/);
    await expect(adapter.writeNote('note.md', 'x', context)).rejects.toThrow(/approved/);
    await adapter.writeNote('note.md', '# Note\n\n[[Other]] #tag', { ...context, approval: { approved: true } });
    expect(events.at(-1)).toMatchObject({ action: 'obsidian.write', userId: 'user-1', tenantId: 'tenant-a', domain: 'notes', siteId: 'site-1' });
  });

  test('returns bounded graph context from a note', async () => {
    const adapter = new ObsidianVaultAdapter({ vaultRoot: root });
    const approved = { ...context, approval: { approved: true } };
    await adapter.writeNote('note.md', '[[Zed]] [[Alpha|alias]] #project #ops', approved);
    const graph = await adapter.graphContext('note.md', context);
    expect(graph).toMatchObject({ path: 'note.md', links: ['Alpha', 'Zed'], tags: ['#ops', '#project'] });
  });

  test('does not expose raw coordinates in audit events or provider URI', async () => {
    let opened;
    const adapter = new ObsidianVaultAdapter({ vaultRoot: root, uriOpener: async (uri) => { opened = uri; }, audit: async (event) => events.push(event) });
    await adapter.open('note.md', { ...context, location: { latitude: 1.2, longitude: 3.4 } }, { vault: 'Vault' });
    expect(opened).toContain('obsidian://open');
    expect(opened).not.toMatch(/1\.2|3\.4|latitude|longitude/);
    expect(events.at(-1)).not.toHaveProperty('latitude');
    expect(events.at(-1)).not.toHaveProperty('longitude');
  });

  test('supports degraded availability checks', async () => {
    const adapter = new ObsidianVaultAdapter({ vaultRoot: path.join(root, 'missing') });
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });
});

describe('extractGraph', () => {
  test('deduplicates and sorts links and tags', () => {
    expect(extractGraph('[[B]] [[A]] [[B]] #z #a')).toEqual({ links: ['A', 'B'], tags: ['#a', '#z'] });
  });
});
