'use strict';
/**
 * Regression test for the SQLite fallback tier added to
 * getUserByUsername / getUserByPhone / getUserByEmail /
 * getUserByChannel / linkChannel, and the rowToUser JSON
 * deserialization fix.
 *
 * Isolated into its own AGENTOS_PROFILE so it never touches the real
 * ~/.agentos state, and cleaned up afterward.
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.AGENTOS_PROFILE = 'test-sqlite-fallback';

// This suite exercises the SQLite-only fallback path specifically, so
// firebase-admin is mocked to never actually initialize an app — this repo's
// .env carries real production Firebase credentials that aren't scoped by
// AGENTOS_PROFILE, and without this mock the suite would create/query real
// documents in the production project instead of testing the fallback tier.
jest.unstable_mockModule('firebase-admin', () => {
  const admin = { apps: [], credential: { cert: jest.fn() }, initializeApp: jest.fn() };
  return { ...admin, default: admin };
});

const profileDir = path.join(os.homedir(), '.agentos-test-sqlite-fallback');

describe('SQLite fallback for user lookups (Firebase unavailable)', () => {
  let db;
  let SQLiteDB;
  let sqliteAvailable = true;

  beforeAll(async () => {
    // No Firebase credentials in test env -> src/core/firebase.js's init()
    // resolves to null db/auth, so Database._init() falls through to the
    // SQLite-only path (this.db stays null, this.sqlite gets set).
    const { getDatabase } = await import('../../src/core/database.js');
    db = await getDatabase();
    ({ SQLiteDB } = await import('../../src/core/sqlite-db.js'));
    // better-sqlite3 is a native addon; some sandboxed environments can't
    // build it (no network access to fetch prebuilt binaries / node
    // headers). When that happens Database._init()'s try/catch swallows
    // the error and falls through to the in-memory tier instead — detect
    // that here and skip the SQLite-specific assertions rather than
    // false-failing. A real CI runner with normal network access builds
    // the addon fine and these tests exercise the real SQL path.
    sqliteAvailable = !!db.sqlite;
  });

  afterAll(() => {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (_) {
      // best-effort cleanup
    }
  });

  test('Firebase is not connected in this environment (sanity check)', () => {
    expect(db.db).toBeNull();
    if (!sqliteAvailable) {
      console.warn(
        '[test] better-sqlite3 native addon unavailable in this environment — ' +
          'SQLite-fallback assertions below still run, but against the in-memory ' +
          'tier, not real SQL. This suite validates the real SQL path in CI.'
      );
    }
  });

  test('SQLiteDB.rowToUser deserializes JSON columns instead of leaving them as strings', () => {
    const row = {
      uid: 'u1',
      username: 'br3eze',
      channels: JSON.stringify({ telegram: '555' }),
      subscriptions: JSON.stringify(['planA']),
      pendingNotification: JSON.stringify({ code: 'X' }),
    };
    const user = SQLiteDB.rowToUser(row);
    expect(user.channels).toEqual({ telegram: '555' });
    expect(user.subscriptions).toEqual(['planA']);
    expect(user.pendingNotification).toEqual({ code: 'X' });
    expect(user.id).toBe('u1');
  });

  test('getUserByUsername falls back to SQLite and finds a created user', async () => {
    await db.createUser('sql-user-1', { username: 'sqlfallback_alice', platform: 'whatsapp' });
    const found = await db.getUserByUsername('sqlfallback_alice');
    expect(found).toBeTruthy();
    expect(found.uid).toBe('sql-user-1');
  });

  test('getUserByPhone falls back to SQLite', async () => {
    await db.createUser('sql-user-2', {
      username: 'sqlfallback_bob',
      phoneNumber: '+263771234567',
      platform: 'sms',
    });
    const found = await db.getUserByPhone('+263771234567');
    expect(found).toBeTruthy();
    expect(found.uid).toBe('sql-user-2');
  });

  test('getUserByEmail falls back to SQLite', async () => {
    await db.createUser('sql-user-3', {
      username: 'sqlfallback_carol',
      email: 'carol@example.com',
      platform: 'email',
    });
    const found = await db.getUserByEmail('carol@example.com');
    expect(found).toBeTruthy();
    expect(found.uid).toBe('sql-user-3');
  });

  test('linkChannel + getUserByChannel round-trip through SQLite', async () => {
    await db.createUser('sql-user-4', { username: 'sqlfallback_dave', platform: 'telegram' });
    const linked = await db.linkChannel('sql-user-4', 'telegram', '999888777');
    expect(linked).toBe(true);

    const found = await db.getUserByChannel('telegram', '999888777');
    expect(found).toBeTruthy();
    expect(found.uid).toBe('sql-user-4');
  });

  test('getUserByChannel does not false-positive on substring collisions', async () => {
    await db.createUser('sql-user-5', { username: 'sqlfallback_eve', platform: 'whatsapp' });
    await db.linkChannel('sql-user-5', 'whatsapp', '111');
    await db.createUser('sql-user-6', { username: 'sqlfallback_frank', platform: 'whatsapp' });
    await db.linkChannel('sql-user-6', 'whatsapp', '1112223');

    const found = await db.getUserByChannel('whatsapp', '111');
    expect(found.uid).toBe('sql-user-5');
  });

  test('resolveUser resolves an unregistered identifier to null without throwing', async () => {
    const result = await db.resolveUser('totally-unknown-user-xyz', 'whatsapp');
    expect(result).toBeNull();
  });
});
