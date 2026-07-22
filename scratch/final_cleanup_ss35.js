const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'ss35.js');
let content = fs.readFileSync(filePath, 'utf8');

const startMarker = '// [DELETED - Moved to src/core/database.js]';
const endMarker = '// ============================================================\n// §16  EXPRESS APPLICATION';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    console.log(`Found markers. Removing content from ${startIndex} to ${endIndex}`);
    const before = content.slice(0, startIndex);
    const after = content.slice(endIndex);
    
    const replacement = `// ── Legacy logic removed. Using modular core services. ────────\n\n`;
    content = before + replacement + after;
    fs.writeFileSync(filePath, content);
    console.log('Final cleanup complete.');
} else {
    console.log('Markers not found or in wrong order.');
    console.log('startIndex:', startIndex);
    console.log('endIndex:', endIndex);
}
