require('dotenv').config();
const admin = require('firebase-admin');

try {
    admin.firestore.setLogFunction(console.log);
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log('✅ Firebase connected!');
    console.log('Project:', process.env.FIREBASE_PROJECT_ID);

    // Test write
    const db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true, preferRest: true });
    db.collection('test').doc('connection').set({
        timestamp: new Date(),
        status: 'working'
    }).then(() => {
        console.log('✅ Write test passed!');
        process.exit(0);
    });

} catch (error) {
    console.error('❌ Firebase connection failed:', error.message);
    process.exit(1);
}