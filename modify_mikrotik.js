const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'core', 'mikrotik.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace "_ensureConnected() {" with "async _ensureConnected() {"
content = content.replace(/_ensureConnected\(\)\s*\{/, 'async _ensureConnected() {');

// Replace "this._ensureConnected();" with "await this._ensureConnected();"
content = content.replace(/(?<!await\s+)this\._ensureConnected\(\);/g, 'await this._ensureConnected();');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully updated mikrotik.js');
