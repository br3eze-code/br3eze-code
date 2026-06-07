const fs = require('fs');
const key = JSON.parse(fs.readFileSync('serviceAccountKey.json')).private_key;
let env = fs.readFileSync('.env', 'utf8');
env = env.replace(/FIREBASE_PRIVATE_KEY=[\s\S]*?(?=\n[A-Z_]+=|^\w+=|\n$|$)/m, 'FIREBASE_PRIVATE_KEY="' + key.replace(/\n/g, '\\n') + '"');
fs.writeFileSync('.env', env);
