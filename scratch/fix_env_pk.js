const fs = require('fs');
const path = require('path');

try {
    const jsonPath = 'c:/Users/user/br3eze-code/src/core/vault/agentos-firebase-adminsdk.json';
    const envPath = 'c:/Users/user/br3eze-code/.env';

    if (!fs.existsSync(jsonPath)) {
        console.error('JSON not found');
        process.exit(1);
    }

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const pk = json.private_key;

    if (!pk) {
        console.error('Private key not found in JSON');
        process.exit(1);
    }

    console.log('JSON PK Length:', pk.length);

    let env = fs.readFileSync(envPath, 'utf8');
    const regex = /FIREBASE_PRIVATE_KEY=".*"/;
    const replacement = `FIREBASE_PRIVATE_KEY="${pk.replace(/\n/g, '\\n')}"`;

    if (regex.test(env)) {
        env = env.replace(regex, replacement);
        fs.writeFileSync(envPath, env);
        console.log('Updated .env with key from JSON');
    } else {
        console.log('FIREBASE_PRIVATE_KEY not found in .env with expected format');
    }

} catch (e) {
    console.error('Error:', e);
}
