
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pk = process.env.FIREBASE_PRIVATE_KEY;
if (!pk) {
    console.log('FIREBASE_PRIVATE_KEY not found');
    process.exit(1);
}

const clean = pk.replace(/\\n/g, '\n').replace(/"/g, '');
const header = "-----BEGIN PRIVATE KEY-----";
const footer = "-----END PRIVATE KEY-----";

if (clean.includes(header) && clean.includes(footer)) {
    const body = clean.split(header)[1].split(footer)[0].replace(/\s/g, '');
    console.log('Body length:', body.length);
    console.log('Body % 4:', body.length % 4);
    console.log('Last 20 chars:', body.slice(-20));
} else {
    console.log('Header/Footer mismatch');
    console.log('PK starts with:', pk.slice(0, 50));
}
