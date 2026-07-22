/**
 * Fix the PowerShell COM port extraction in printer.js.
 * Replaces split-based extraction with a regex match that is immune
 * to backslash-escaping variations.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/core/printer.js');
let content = fs.readFileSync(file, 'utf8');

// The old split line (appears twice — in printVoucher and printRaw)
const OLD_COMMENT  = "        # Robustly extract COM port name (e.g., \\\\.\\COM7 -> COM7)\r\n";
const OLD_SPLIT    = "        $portName = ($p -split '\\\\\\\\')[-1]\r\n";

const NEW_COMMENT  = "        # Extract COM port name robustly via regex (immune to backslash-escaping variations)\r\n";
const NEW_EXTRACT  = "        if ($p -match '(COM\\d+)') { $portName = $Matches[1] } else { $portName = $p }\r\n";

const OLD = OLD_COMMENT + OLD_SPLIT;
const NEW = NEW_COMMENT + NEW_EXTRACT;

const occurrences = content.split(OLD).length - 1;
console.log(`Found ${occurrences} occurrence(s) of the old split pattern.`);

if (occurrences === 0) {
    // Try with unix line endings
    const OLD_U = OLD.replace(/\r\n/g, '\n');
    const NEW_U = NEW.replace(/\r\n/g, '\n');
    const occU = content.split(OLD_U).length - 1;
    console.log(`Found ${occU} occurrence(s) with unix line endings.`);
    if (occU > 0) {
        content = content.split(OLD_U).join(NEW_U);
        fs.writeFileSync(file, content, 'utf8');
        console.log(`✅ Fixed ${occU} occurrence(s) (unix line endings).`);
        return;
    }
    console.error('❌ Pattern not found. Dumping surrounding lines for inspection...');
    // Print lines 408-414 and 649-656
    const lines = content.split(/\r?\n/);
    [408, 409, 410, 411, 412, 413, 649, 650, 651, 652, 653, 654].forEach(i => {
        console.log(`  Line ${i+1}: ${JSON.stringify(lines[i])}`);
    });
    process.exit(1);
}

content = content.split(OLD).join(NEW);
fs.writeFileSync(file, content, 'utf8');
console.log(`✅ Fixed ${occurrences} occurrence(s).`);
