'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function migrate() {
    console.log('Starting migration: Removing createdAt from all plans...');

    // Initialize Firebase
    if (!admin.apps.length) {
        let credential;
        const saPath = process.env.FIREBASE_SERVICE_ACCOUNT || './serviceAccountKey.json';
        
        if (fs.existsSync(saPath)) {
            credential = admin.credential.cert(require(path.resolve(saPath)));
            console.log(`Firebase: using service account from ${saPath}`);
        } else if (process.env.FIREBASE_PRIVATE_KEY) {
            let pk = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
            credential = admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                privateKey: pk,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            });
            console.log('Firebase: using environment variables');
        }

        if (!credential) {
            console.error('Error: No Firebase credentials found.');
            process.exit(1);
        }

        admin.initializeApp({ credential });
    }

    const db = admin.firestore();
    const plansRef = db.collection('plans');
    const snapshot = await plansRef.get();

    if (snapshot.empty) {
        console.log('No plans found in collection.');
        return;
    }

    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.createdAt) {
            batch.update(doc.ref, {
                createdAt: admin.firestore.FieldValue.delete()
            });
            count++;
            console.log(`Queueing removal for doc: ${doc.id}`);
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Migration complete. Removed createdAt from ${count} documents.`);
    } else {
        console.log('No documents required updating.');
    }
}

migrate()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
