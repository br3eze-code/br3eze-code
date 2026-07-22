
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const saPath = path.resolve('src/core/vault/agentos-firebase-adminsdk.json');
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
let key = sa.private_key;

const cleanKey = (key) => {
    if (!key) return key;
    let cleaned = key.replace(/\\n/g, '\n').trim();
    const header = '-----BEGIN PRIVATE KEY-----';
    const footer = '-----END PRIVATE KEY-----';
    
    let body = cleaned;
    if (cleaned.includes(header)) body = body.split(header)[1];
    if (body.includes(footer)) body = body.split(footer)[0];
    
    body = body.replace(/\s/g, '');
    const wrappedBody = body.match(/.{1,64}/g).join('\n');
    
    return `${header}\n${wrappedBody}\n${footer}\n`;
};

const fixedKey = cleanKey(key);

console.log('Fixed Key length:', fixedKey.length);
try {
    crypto.createSign('RSA-SHA256').update('test').sign(fixedKey);
    console.log('Fixed Key works!');
} catch (e) {
    console.log('Fixed Key fails:', e.message);
}
