require('dotenv').config();
const { initializeFirebase } = require('../src/core/firebase');

async function listEmails() {
  const { app, db } = initializeFirebase();
  if (!app) {
    console.error('Firebase not initialized.');
    return;
  }
  const admin = require('firebase-admin');
  const auth = admin.auth();
  
  console.log('Listing users from Auth...');
  const result = await auth.listUsers(1000);
  result.users.forEach(u => {
    console.log(`Email: ${u.email}, UID: ${u.uid}, DisplayName: ${u.displayName}`);
  });
  process.exit(0);
}

listEmails();
