const src = require('fs').readFileSync('./src/core/security.js', 'utf8');
const reqs = Array.from(src.matchAll(/require\(['"]([^'"./][^'"]*)['"]\)/g)).map(m => m[1]);
const unique = Array.from(new Set(reqs));
console.log(unique.join('\n'));
