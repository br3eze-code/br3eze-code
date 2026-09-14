import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteSubagentStore } from '../../src/adapters/persistence/sqlite-subagent-store.js';

describe('SqliteSubagentStore', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'agentos-subagent-'));
    store = new SqliteSubagentStore({ dbPath: path.join(dir, 'agentos.sqlite') });
    store.initialize();
  });

  afterEach(() => {
    store._db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('persists create and update across store instances', () => {
    const created = store.create({
      id: 'sa-1', parentId: null, role: 'worker', scope: { tenantId: 't1' },
      permissions: ['read'], depth: 0, budget: 10, spent: 0, status: 'ready',
      createdAt: Date.now(), metadata: { source: 'test' },
    });
    store.update(created.id, { status: 'running', spent: 2 });

    const second = new SqliteSubagentStore({ dbPath: path.join(dir, 'agentos.sqlite') });
    second.initialize();
    expect(second.get('sa-1')).toMatchObject({ status: 'running', spent: 2, scope: { tenantId: 't1' }, permissions: ['read'] });
    second._db?.close();
  });

  test('lists by parent and status', () => {
    const base = { parentId: 'root', role: 'worker', scope: {}, permissions: [], depth: 1, budget: 5, spent: 0, status: 'ready', createdAt: Date.now(), metadata: {} };
    store.create({ ...base, id: 'a' });
    store.create({ ...base, id: 'b', status: 'running' });
    expect(store.list({ parentId: 'root' }).map((x) => x.id)).toEqual(['a', 'b']);
    expect(store.list({ parentId: 'root', status: 'running' }).map((x) => x.id)).toEqual(['b']);
  });
});
