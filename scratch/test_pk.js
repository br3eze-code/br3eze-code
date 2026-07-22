const fs = require('fs');
const crypto = require('crypto');

try {
    const sa = JSON.parse(fs.readFileSync('./src/core/vault/agentos-firebase-adminsdk.json', 'utf8'));
    const pk = sa.private_key;
    console.log('Testing private key...');
    const key = crypto.createPrivateKey(pk);
    console.log('Key is valid!');
} catch (e) {
    console.error('Key validation failed:', e.message);
    if (e.stack) console.error(e.stack);
}
