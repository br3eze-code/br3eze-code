'use strict';
const { getDatabase } = require('../src/core/database');
const { logger } = require('../src/core/logger');

async function migrate() {
    const db = await getDatabase();
    const plans = await db.getPlans(false);
    const idMap = {}; // oldId -> newId

    console.log(`Starting migration for ${plans.length} plans...`);

    // 1. Process Plans
    for (const plan of plans) {
        const newId = db.hashPlanId(plan.name);
        const oldId = plan.id;
        idMap[oldId] = newId;

        // Infer mikrotikProfile if missing
        let inferredProfile = plan.mikrotikProfile;
        if (!inferredProfile) {
            const clean = plan.name.toLowerCase().replace(/\s+/g, '');
            if (clean.includes('1hour')) inferredProfile = '1Hour';
            else if (clean.includes('1day')) inferredProfile = '1Day';
            else if (clean.includes('7day')) inferredProfile = '7Day';
            else if (clean.includes('30day')) inferredProfile = '30Day';
            else inferredProfile = 'default';
        }

        const newDoc = {
            ...plan,
            id: newId,
            mikrotikProfile: inferredProfile,
            active: plan.active !== false
        };
        delete newDoc.id; // Firestore uses doc ID

        console.log(`Migrating Plan: "${plan.name}" | ${oldId} -> ${newId} (Profile: ${inferredProfile})`);

        if (db.db) {
            await db.db.collection('plans').doc(newId).set(newDoc, { merge: true });
            if (oldId !== newId) {
                await db.db.collection('plans').doc(oldId).delete();
            }
        } else {
            db._plans.set(newId, newDoc);
            if (oldId !== newId) db._plans.delete(oldId);
        }
    }

    if (!db.db) db._saveLocal('plans');

    // 2. Process Vouchers
    console.log('Migrating Vouchers...');
    const vouchers = await db.getVouchers({ limit: 1000 });
    let voucherCount = 0;
    for (const v of vouchers) {
        if (v.plan && idMap[v.plan]) {
            const newId = idMap[v.plan];
            if (v.plan !== newId) {
                if (db.db) {
                    await db.db.collection('vouchers').doc(v.id).update({ plan: newId });
                } else {
                    const doc = db._vouchers.get(v.id);
                    doc.plan = newId;
                    db._vouchers.set(v.id, doc);
                }
                voucherCount++;
            }
        }
    }
    if (!db.db) db._saveLocal('vouchers');
    console.log(`Updated ${voucherCount} vouchers.`);

    // 3. Process Users
    console.log('Migrating User Subscriptions...');
    // We don't have a getUsers method easily accessible for all users, but we can query Firestore
    if (db.db) {
        const userSnap = await db.db.collection('users').get();
        let userCount = 0;
        for (const userDoc of userSnap.docs) {
            const data = userDoc.data();
            if (data.subscriptions && Array.isArray(data.subscriptions)) {
                let changed = false;
                const newSubs = data.subscriptions.map(s => {
                    if (s.planId && idMap[s.planId]) {
                        if (s.planId !== idMap[s.planId]) {
                            changed = true;
                            return { ...s, planId: idMap[s.planId] };
                        }
                    }
                    return s;
                });
                if (changed) {
                    await userDoc.ref.update({ subscriptions: newSubs });
                    userCount++;
                }
            }
        }
        console.log(`Updated ${userCount} users.`);
    } else {
        let userCount = 0;
        for (const [uid, data] of db._users.entries()) {
             if (data.subscriptions && Array.isArray(data.subscriptions)) {
                let changed = false;
                const newSubs = data.subscriptions.map(s => {
                    if (s.planId && idMap[s.planId]) {
                         if (s.planId !== idMap[s.planId]) {
                            changed = true;
                            return { ...s, planId: idMap[s.planId] };
                        }
                    }
                    return s;
                });
                if (changed) {
                    data.subscriptions = newSubs;
                    db._users.set(uid, data);
                    userCount++;
                }
            }
        }
        db._saveLocal('users');
        console.log(`Updated ${userCount} users.`);
    }

    console.log('Migration complete!');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
