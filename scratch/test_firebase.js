
const admin = require('firebase-admin');
const sa = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(sa)
});

const db = admin.firestore();

async function test() {
  console.log('Testing Firestore...');
  try {
    const snapshot = await db.collection('vouchers').limit(1).get();
    console.log('Successfully connected! Found', snapshot.size, 'vouchers.');
  } catch (e) {
    console.error('Firestore connection failed:', e.message);
  }
  process.exit();
}

test();
