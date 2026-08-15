import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '../../src/core/tool-registry.js';

let root;
let registry;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentos-workspace-test-'));
  await fs.writeFile(path.join(root, 'hello.txt'), 'one\ntwo\n', 'utf8');
  registry = new ToolRegistry({ skillsPath: path.resolve('src/skills'), workspace: root });
  assert.equal(await registry.loadSkill('workspace'), true);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('discovers workspace inspection and mutation tools', () => {
  assert.ok(registry.getTool('workspace.files'));
  assert.ok(registry.getTool('workspace.edit'));
});

test('requires approval and supports patch plus undo', async () => {
  const blocked = await registry.execute('workspace.edit', {
    operation: 'patch', path: 'hello.txt', edits: [{ find: 'one', replace: 'ONE' }]
  });
  assert.equal(blocked.approvalRequired, true);

  const changed = await registry.execute('workspace.edit', {
    operation: 'patch', path: 'hello.txt', edits: [{ find: 'one', replace: 'ONE' }]
  }, { approved: true, userId: 'test-user' });
  assert.equal(changed.changed, true);
  assert.equal(await fs.readFile(path.join(root, 'hello.txt'), 'utf8'), 'ONE\ntwo\n');

  await registry.execute('workspace.edit', { operation: 'undo', undoId: changed.undoId }, { approved: true });
  assert.equal(await fs.readFile(path.join(root, 'hello.txt'), 'utf8'), 'one\ntwo\n');
});

test('rejects paths outside the workspace', async () => {
  await assert.rejects(
    registry.execute('workspace.files', { operation: 'read', path: '../escape.txt' }),
    /escapes workspace/
  );
});
