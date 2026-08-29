import admin from 'firebase-admin';
import 'dotenv/config';
async function check() {
    if (!admin.apps.length) {
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
        } else {
            admin.initializeApp({ credential: admin.credential.applicationDefault() });
        }
    }

    const db = admin.firestore();
    const plansRef = db.collection('plans');
    const snapshot = await plansRef.get();

    console.log(`Found ${snapshot.size} plans.`);
    snapshot.forEach(doc => {
        console.log(`- ${doc.id}: keys=[${Object.keys(doc.data()).join(', ')}]`);
    });
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
