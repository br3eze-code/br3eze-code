const { getDatabase } = require('../src/core/database');
const admin = require('firebase-admin');

async function removeCreatedAtFromPlans() {
    try {
        console.log('Initializing database...');
        const db = await getDatabase();
        
        // Ensure initialized if using Firestore
        if (!db.db) {
            console.log('Database not using Firestore. Checking local state...');
            // In-memory/local state handling if needed, 
            // but usually this request implies Firestore.
        }

        console.log('Fetching all plans...');
        const plans = await db.getPlans(false);
        console.log(`Found ${plans.length} plans.`);

        const FieldValue = admin.firestore.FieldValue;

        for (const plan of plans) {
            console.log(`Processing plan: ${plan.id || plan.planId}...`);
            if (db.db) {
                await db.db.collection('plans').doc(plan.id || plan.planId).update({
                    createdAt: FieldValue.delete()
                });
            } else {
                // Local state
                const id = plan.id || plan.planId;
                if (db._plans.has(id)) {
                    const data = db._plans.get(id);
                    delete data.createdAt;
                    db._plans.set(id, data);
                }
            }
        }

        if (!db.db) {
             db._saveLocal('plans');
        }

        console.log('Success: createdAt field removed from all plans.');
        await db.close();
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

removeCreatedAtFromPlans();
