/**
 * Regression test for redeemVoucher() via the SQLite fallback path.
 *
 * Locks in two real bugs found and fixed in this pass:
 *  1. The `users` table had no `vouchersUsed` column at all, but
 *     redeemVoucher()'s UPDATE statement wrote to it — a real
 *     "no such column" crash on every SQLite-path redemption.
 *  2. getPlan()/getVoucher()/getAllPlans() and the lookups inside
 *     redeemVoucher()'s own transaction used the whole-row fromDB()
 *     misuse (JSON.parse on an object silently no-ops), so vouchersUsed
 *     history was being reset to just the current code on every
 *     redemption instead of accumulating.
 *
 * Isolated into its own AGENTOS_PROFILE, cleaned up afterward.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDatabase } from '../../src/core/database.js';

process.env.AGENTOS_PROFILE = 'test-voucher-redemption';

const profileDir = path.join(os.homedir(), '.agentos-test-voucher-redemption');

describe('redeemVoucher via SQLite fallback', () => {
  let db;
  let sqliteAvailable = true;

  beforeAll(async () => {
    db = await getDatabase();
    sqliteAvailable = !!db.sqlite;
    if (!sqliteAvailable) {
      console.warn(
        '[test] better-sqlite3 native addon unavailable in this environment — ' +
          'skipping SQLite-specific assertions. This suite validates the real ' +
          'SQL path (including the vouchersUsed column fix) in CI.'
      );
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (_) {
      // best-effort cleanup
    }
  });

  test('createVoucher + redeemVoucher does not throw "no such column: vouchersUsed"', async () => {
    if (!sqliteAvailable) return;

    await db.createUser('voucher-user-1', { username: 'voucher_tester', platform: 'whatsapp' });
    await db.createVoucher('TESTCODE1', { value: 10, currency: 'USD', durationUnit: 'days', durationValue: 30 });

    await expect(db.redeemVoucher('TESTCODE1', { uid: 'voucher-user-1' })).resolves.toBeDefined();
  });

  test('vouchersUsed accumulates across multiple redemptions instead of resetting', async () => {
    if (!sqliteAvailable) return;

    await db.createUser('voucher-user-2', { username: 'voucher_tester2', platform: 'whatsapp' });
    await db.createVoucher('TESTCODE2', { value: 5, currency: 'USD', durationUnit: 'days', durationValue: 7 });
    await db.createVoucher('TESTCODE3', { value: 5, currency: 'USD', durationUnit: 'days', durationValue: 7 });

    await db.redeemVoucher('TESTCODE2', { uid: 'voucher-user-2' });
    await db.redeemVoucher('TESTCODE3', { uid: 'voucher-user-2' });

    const user = await db.getUser('voucher-user-2');
    expect(user.vouchersUsed).toEqual(expect.arrayContaining(['TESTCODE2', 'TESTCODE3']));
    expect(user.vouchersUsed).toHaveLength(2);
  });

  test('getPlan() correctly deserializes the features JSON column', async () => {
    if (!sqliteAvailable) return;

    await db.createPlan('test-plan-1', {
      name: 'Test Plan',
      value: 5,
      currency: 'USD',
      durationUnit: 'days',
      durationValue: 30,
      features: { hd: true, maxSpeed: '10Mbps' },
    });

    const plan = await db.getPlan('test-plan-1');
    expect(plan.features).toEqual({ hd: true, maxSpeed: '10Mbps' });
  });

  test('getVoucher() correctly deserializes the redemption JSON column', async () => {
    if (!sqliteAvailable) return;

    await db.createVoucher('TESTCODE4', {
      value: 5,
      currency: 'USD',
      durationUnit: 'days',
      durationValue: 7,
    });

    const voucher = await db.getVoucher('TESTCODE4');
    expect(voucher.redemption).toEqual(
      expect.objectContaining({ used: false, remainingValue: 5 })
    );
  });

  test('getPlans() correctly deserializes features for every row', async () => {
    if (!sqliteAvailable) return;

    await db.createPlan('test-plan-2', {
      name: 'Another Plan',
      value: 8,
      currency: 'USD',
      durationUnit: 'days',
      durationValue: 30,
      features: { hd: false },
    });

    const plans = await db.getPlans(false);
    const found = plans.find(p => p.id === 'test-plan-2');
    expect(found.features).toEqual({ hd: false });
  });
});
