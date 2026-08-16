import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.AGENTOS_PROFILE = 'test-user-lifecycle-graph';
jest.unstable_mockModule('firebase-admin', () => {
  const admin = { apps: [], credential: { cert: jest.fn() }, initializeApp: jest.fn() };
  return { ...admin, default: admin };
});

const profileDir = path.join(os.homedir(), '.agentos-test-user-lifecycle-graph');

describe('per-user lifecycle graph synchronization', () => {
  let db;

  beforeAll(async () => {
    const databaseModule = await import('../../src/core/database.js');
    db = await databaseModule.getDatabase();
  });

  afterAll(() => {
    fs.rmSync(profileDir, { recursive: true, force: true });
  });

  test('create, update, and channel linking append scoped lifecycle events', async () => {
    const uid = 'graph-user-1';
    await db.createUser(uid, { username: 'graph-user', tenantId: 'tenant-a', domain: 'network', siteId: 'site-1' });
    await db.updateUser(uid, { status: 'active', tenantId: 'tenant-a', domain: 'network', siteId: 'site-1' });
    await db.linkChannel(uid, 'telegram', '123456');

    const graph = await db.getUserLifecycleGraph(uid);
    expect(graph.uid).toBe(uid);
    expect(graph.tenantId).toBe('tenant-a');
    expect(graph.domain).toBe('network');
    expect(graph.siteId).toBe('site-1');
    expect(graph.events.map((event) => event.eventType)).toEqual([
      'user.created',
      'user.updated',
      'channel.linked'
    ]);
    expect(graph.edges).toHaveLength(3);
  });
});
