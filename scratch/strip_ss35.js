const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'ss35.js');
let content = fs.readFileSync(filePath, 'utf8');

function removeClass(className) {
    const regex = new RegExp(`class\\s+${className}\\s*{`, 'g');
    const match = regex.exec(content);
    if (!match) {
        console.log(`Class not found: ${className}`);
        return false;
    }

    const startIndex = match.index;
    let braceCount = 1;
    let i = match.index + match[0].length;

    while (braceCount > 0 && i < content.length) {
        if (content[i] === '{') braceCount++;
        else if (content[i] === '}') braceCount--;
        i++;
    }

    if (braceCount === 0) {
        console.log(`Removing class: ${className} (${startIndex}-${i})`);
        const before = content.slice(0, startIndex);
        const after = content.slice(i);
        content = before + `// [DELETED ${className} - Moved to modular core]\n` + after;
        return true;
    }
    console.log(`Could not find closing brace for class: ${className}`);
    return false;
}

function removeVar(varName) {
    const regex = new RegExp(`const\\s+${varName}\\s*=\\s*`, 'g');
    const match = regex.exec(content);
    if (!match) {
        console.log(`Var not found: ${varName}`);
        return false;
    }

    const startIndex = match.index;
    let i = match.index + match[0].length;

    // Find end of assignment (semi-colon or end of object/array)
    let braceCount = 0;
    let inString = false;
    let stringChar = '';

    while (i < content.length) {
        const char = content[i];
        if (char === '"' || char === "'" || char === "`") {
            if (!inString) {
                inString = true;
                stringChar = char;
            } else if (char === stringChar && content[i-1] !== '\\') {
                inString = false;
            }
        }

        if (!inString) {
            if (char === '{' || char === '[') braceCount++;
            else if (char === '}' || char === ']') braceCount--;
            else if (char === ';' && braceCount === 0) {
                i++;
                break;
            }
        }
        i++;
    }

    console.log(`Removing var: ${varName} (${startIndex}-${i})`);
    content = content.slice(0, startIndex) + `// [DELETED VAR ${varName}]\n` + content.slice(i);
    return true;
}

// Classes to remove
const classes = [
    'Database',
    'FinancialController',
    'AgentMemory',
    'NodeRegistry',
    'SkillRegistry',
    'MikroTikManager',
    'AskEngine',
    'SystemMonitor',
    'AgentOSGateway',
    'AgentOSBot',
    'AgentOSOrchestrator'
];

classes.forEach(removeClass);

// Vars to remove
const vars = [
    'database',
    'financial',
    'mikrotik',
    'agentMemory',
    'nodeRegistry',
    'TOOLS'
];

vars.forEach(removeVar);

fs.writeFileSync(filePath, content);
console.log('Cleanup complete.');
