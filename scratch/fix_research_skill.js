const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'skills', 'research', 'index.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split(/\r?\n/);

const newLines = [];
let inCustomWrappedCase = false;

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // 1. Fix missing commas in the manifest
  if (line.trim() === '}' && lines[i+1]) {
    const nextLine = lines[i+1].trim();
    if (nextLine.startsWith("'research.") || nextLine.startsWith('"research.')) {
      line = line + ',';
    }
  }
  
  // 2. Wrap case statements in block scopes
  const caseMatch = line.match(/^(\s*)case\s+'(research\.[^']+)'\s*:(.*)$/);
  const defaultMatch = line.match(/^(\s*)default\s*:(.*)$/);
  
  if (caseMatch) {
    const indent = caseMatch[1];
    const rest = caseMatch[3].trim();
    
    // Check if it already has { at the end of the case line or on the next line
    const nextLine = lines[i+1] ? lines[i+1].trim() : '';
    const isAlreadyWrapped = rest.endsWith('{') || nextLine.startsWith('{');
    
    if (inCustomWrappedCase) {
      // Close the previous custom wrapped case
      newLines.push(`${indent}}`);
      inCustomWrappedCase = false;
    }
    
    if (isAlreadyWrapped) {
      newLines.push(line);
    } else {
      newLines.push(`${line} {`);
      inCustomWrappedCase = true;
    }
  } else if (defaultMatch) {
    const indent = defaultMatch[1];
    // Check if it is the outer default by scanning ahead for 'Unknown tool'
    let isOuterDefault = false;
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      if (lines[j].includes('Unknown tool')) {
        isOuterDefault = true;
        break;
      }
    }
    
    if (inCustomWrappedCase && isOuterDefault) {
      newLines.push(`${indent}}`);
      inCustomWrappedCase = false;
    }
    newLines.push(line);
  } else {
    newLines.push(line);
  }
}

fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('Successfully fixed manifest commas and wrapped case statements in block scopes!');
