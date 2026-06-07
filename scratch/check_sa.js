const fs = require('fs');
const path = require('path');
const saPath = './src/core/vault/agentos-firebase-adminsdk.json';
console.log('Path:', saPath);
console.log('Exists:', fs.existsSync(saPath));
console.log('Resolved Path:', path.resolve(saPath));
console.log('Resolved Exists:', fs.existsSync(path.resolve(saPath)));
