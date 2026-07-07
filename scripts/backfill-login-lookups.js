#!/usr/bin/env node
/**
 * One-time backfill: creates lookups/{username:<name>} and lookups/{phone:<digits>}
 * docs for every existing user, so username/phone sign-in works for accounts
 * created before the lookups collection existed. Safe to re-run (idempotent
 * set()s). New signups write their own lookups client-side.
 *
 * Usage: node scripts/backfill-login-lookups.js [--dry-run]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const ROOT = path.join(__dirname, '..');
const keyPath = path.join(ROOT, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
    console.error(`serviceAccountKey.json not found at ${keyPath}`);
    process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });

const dryRun = process.argv.includes('--dry-run');
const db = admin.firestore();

(async () => {
    const snap = await db.collection('users').get();
    console.log(`Found ${snap.size} user docs`);
    let written = 0, skippedNoEmail = 0, collisions = 0;
    const seen = new Map(); // lookup key -> uid (detect duplicate usernames/phones)
    let batch = db.batch(), batchCount = 0;

    for (const doc of snap.docs) {
        const u = doc.data();
        const uid = u.uid || doc.id;
        if (!u.email) { skippedNoEmail++; continue; }
        const data = { uid, email: u.email };
        if (u.username) data.username = String(u.username).toLowerCase();

        const keys = ['email:' + String(u.email).toLowerCase()];
        if (u.username) keys.push('username:' + String(u.username).toLowerCase());
        const digits = String(u.phoneNumber || '').replace(/\D/g, '');
        if (digits.length >= 7) keys.push('phone:' + digits);

        for (const key of keys) {
            if (seen.has(key) && seen.get(key) !== uid) {
                console.warn(`COLLISION: ${key} claimed by both ${seen.get(key)} and ${uid} — keeping first`);
                collisions++;
                continue;
            }
            seen.set(key, uid);
            if (!dryRun) {
                batch.set(db.collection('lookups').doc(key), data);
                batchCount++;
                if (batchCount >= 400) { await batch.commit(); batch = db.batch(); batchCount = 0; }
            }
            written++;
        }
    }
    if (!dryRun && batchCount > 0) await batch.commit();
    console.log(`${dryRun ? '[dry-run] would write' : 'Wrote'} ${written} lookup docs; ${skippedNoEmail} users without email skipped; ${collisions} collisions`);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
