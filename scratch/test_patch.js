
const admin = require('firebase-admin');
const forge = require('node-forge');

// Monkey patch node-forge to support 256-bit integers in putInt
const originalCheck = forge.util._checkBitsParam;
forge.util._checkBitsParam = function(n) {
    if (n === 256) return;
    return originalCheck(n);
};

// Also need to patch putInt itself because it might have a switch/case
const originalPutInt = forge.util.putInt;
forge.util.putInt = function(i, n) {
    if (n === 256) {
        // Implementation for 256-bit (32 bytes)
        // This is a guess, but let's see if it works
        // Actually, putInt usually writes a FIXED length integer.
        // If n is 256, it should write 32 bytes.
        // But forge.util.putInt is usually for 8, 16, 24, 32 bits.
        // Wait! I'll just let it fail if it's not one of those, 
        // BUT I'll see if I can bypass the check and let it try.
    }
    return originalPutInt.call(this, i, n);
};

require('dotenv').config();

const cleanPk = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

try {
    const app = admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: cleanPk,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        })
    });
    console.log('Success! Firebase app initialized with monkey patch.');
    process.exit(0);
} catch (err) {
    console.error('Failed even with monkey patch:');
    console.error(err);
    process.exit(1);
}
