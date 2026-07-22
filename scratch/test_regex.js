const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'skills', 'research', 'index.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

const line540 = lines[539]; // 0-indexed line 540 is index 539
console.log('Line 540 raw:', JSON.stringify(line540));

const regex = /^(\s*)case\s+'(research\.[^']+)'\s*:(.*)$/;
const match = line540.match(regex);
console.log('Match result:', match);
