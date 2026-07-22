
const admin = require('firebase-admin');
const dotenv = require('dotenv');
dotenv.config();

let pk = process.env.FIREBASE_PRIVATE_KEY;
if (!pk) {
    console.error('FIREBASE_PRIVATE_KEY not found in .env');
    process.exit(1);
}

const header = "-----BEGIN PRIVATE KEY-----";
const footer = "-----END PRIVATE KEY-----";
let body = pk.replace(header, '').replace(footer, '').replace(/\\n/g, '').replace(/\s/g, '').replace(/"/g, '');
let cleanPk = `${header}\n${body.match(/.{1,64}/g).join('\n')}\n${footer}`;

console.log('Cleaned length:', cleanPk.length);
console.log('Cleaned starts with:', cleanPk.substring(0, 30));
console.log('Cleaned ends with:', cleanPk.substring(cleanPk.length - 30));

try {
    const app = admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: cleanPk,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        })
    });
    console.log('Success! Firebase app initialized.');
    process.exit(0);
} catch (e) {
    console.error('Failed to initialize Firebase:');
    console.error(e);
    process.exit(1);
}
