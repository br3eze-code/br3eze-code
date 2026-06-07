/**
 * Fix: extract COM port name in JS (not in PowerShell) and inject it
 * directly into the PS script. This eliminates all backslash-escaping
 * ambiguity in the PowerShell layer.
 *
 * Changes made to both printVoucher() and printRaw() in printer.js:
 *   - After rawTarget is computed, extract portName via JS regex
 *   - Replace the PS-side regex/split extraction with a hardcoded $portName
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/core/printer.js');
let content = fs.readFileSync(file, 'utf8');

// ── Pattern A: the psScript template literal header (appears in BOTH functions)
// We need to inject $portName = "<extracted>" right after $p and $isSpooler are set.
// Strategy: replace the existing PS regex-extraction line with a JS-computed placeholder.

// In the template literal the PS lines look like (with \r\n endings):
const OLD_PS_EXTRACT =
    "        # Extract COM port name robustly via regex (immune to backslash-escaping variations)\r\n" +
    "        if ($p -match '(COM\\d+)') { $portName = $Matches[1] } else { $portName = $p }\r\n";

// New version: portName is computed in JS and spliced into the template literal
const NEW_PS_EXTRACT =
    "        # portName is pre-computed in JS to avoid PS backslash-escaping issues\r\n" +
    "        $portName = \"${serialPortName}\"\r\n";

// Count occurrences
const countBefore = content.split(OLD_PS_EXTRACT).length - 1;
console.log(`Found ${countBefore} occurrence(s) of the old PS extraction pattern.`);

if (countBefore === 0) {
    // Try unix line endings
    const OLD_U = OLD_PS_EXTRACT.replace(/\r\n/g, '\n');
    const NEW_U = NEW_PS_EXTRACT.replace(/\r\n/g, '\n');
    const countU = content.split(OLD_U).length - 1;
    console.log(`With unix endings: ${countU} occurrence(s)`);
    if (countU > 0) {
        content = content.split(OLD_U).join(NEW_U);
        // Patch the JS side to compute serialPortName (done below)
    } else {
        console.error('❌ Old PS extraction pattern not found. Aborting.');
        process.exit(1);
    }
} else {
    content = content.split(OLD_PS_EXTRACT).join(NEW_PS_EXTRACT);
}

// ── Patch JS side: for printVoucher — inject serialPortName after rawTarget is computed
// Original line: const rawTarget = isSpooler ? iface.replace('printer:', '') : iface.replace('serial:', '');
const OLD_RAW_TARGET =
    "                const rawTarget = isSpooler ? iface.replace('printer:', '') : iface.replace('serial:', '');\r\n";
const NEW_RAW_TARGET =
    "                const rawTarget = isSpooler ? iface.replace('printer:', '') : iface.replace('serial:', '');\r\n" +
    "                // Extract COMxx in JS so PowerShell receives a clean port name\r\n" +
    "                const _comMatch = rawTarget.match(/COM(\\d+)/i);\r\n" +
    "                const serialPortName = _comMatch ? `COM${_comMatch[1]}` : rawTarget;\r\n";

const countRaw = content.split(OLD_RAW_TARGET).length - 1;
console.log(`Found ${countRaw} occurrence(s) of rawTarget definition.`);

if (countRaw === 0) {
    const OLD_U2 = OLD_RAW_TARGET.replace(/\r\n/g, '\n');
    const NEW_U2 = NEW_RAW_TARGET.replace(/\r\n/g, '\n');
    const countU2 = content.split(OLD_U2).length - 1;
    console.log(`With unix endings: ${countU2} rawTarget occurrence(s)`);
    if (countU2 > 0) {
        content = content.split(OLD_U2).join(NEW_U2);
    } else {
        console.error('❌ rawTarget pattern not found. Aborting.');
        process.exit(1);
    }
} else {
    content = content.split(OLD_RAW_TARGET).join(NEW_RAW_TARGET);
}

fs.writeFileSync(file, content, 'utf8');

// Verify
const verify = fs.readFileSync(file, 'utf8');
const hasNewExtract = verify.includes('portName is pre-computed in JS');
const hasSerialPortName = verify.includes('const serialPortName');
console.log(`✅ PS extraction fix: ${hasNewExtract ? 'OK' : 'MISSING'}`);
console.log(`✅ JS serialPortName inject: ${hasSerialPortName ? 'OK' : 'MISSING'}`);

if (hasNewExtract && hasSerialPortName) {
    console.log('\n✅ All changes applied successfully.');
} else {
    console.error('\n❌ Some changes failed — check printer.js manually.');
    process.exit(1);
}
