const fs = require('fs');
const indexFile = 'www/js/index.js';
const backendFile = 'www/js/backend.js';
const htmlFile = 'www/index.html';

let jsCode = fs.readFileSync(indexFile, 'utf8');

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\n/g, '\\r?\\n');

const strToExtract1Start = '/* ==========================================================\nBackend Server Remote WebSocket Bridge';
const strToExtract1End = 'window.BackendBridge.sendIntent(intentName, payload);\n};\n';

const regex1 = new RegExp(escapeRegex(strToExtract1Start) + '.*?' + escapeRegex(strToExtract1End), 's');
const match1 = jsCode.match(regex1);

const strToExtract2Start = '/* ==========================================================\n   6. AGENT ORCHESTRATOR (AgentOS Core)';
const strToExtract2End = 'return { status: \'unsupported\', message: \'AI Orchestrator not loaded\' };\n};\n';

const regex2 = new RegExp(escapeRegex(strToExtract2Start) + '.*?' + escapeRegex(strToExtract2End), 's');
const match2 = jsCode.match(regex2);

if (match1 && match2) {
    fs.writeFileSync(backendFile, match1[0] + '\n\n' + match2[0] + '\n');
    jsCode = jsCode.replace(match1[0], '');
    jsCode = jsCode.replace(match2[0], '');
    console.log('Successfully extracted code blocks.');
} else {
    console.error('Failed to match code blocks.', !!match1, !!match2);
}

jsCode = jsCode.replace(
    /PermissionsHelper\.configureBackgroundMode\(\);\s*initializeNotificationChannel\(\);/s,
    'initializeNotificationChannel();'
);

jsCode = jsCode.replace(
    /(await PermissionsHelper\.requestAll\(\);\s*})/s,
    '$1\n\n        // 2. Configure background mode AFTER permissions\n        PermissionsHelper.configureBackgroundMode();'
);

fs.writeFileSync(indexFile, jsCode);

let htmlCode = fs.readFileSync(htmlFile, 'utf8');
if (!htmlCode.includes('backend.js')) {
    htmlCode = htmlCode.replace(
        '<script src="js/index.js"></script>',
        '<script src="js/index.js"></script>\n    <script src="js/backend.js"></script>'
    );
    fs.writeFileSync(htmlFile, htmlCode);
    console.log('Updated index.html');
}
