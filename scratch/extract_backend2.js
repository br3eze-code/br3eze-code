const fs = require('fs');
const indexFile = 'www/js/index.js';
const backendFile = 'www/js/backend.js';

let jsCode = fs.readFileSync(indexFile, 'utf8');

// Match Backend Server Remote WebSocket Bridge
const regex1 = /\/\* ==========================================================\s*Backend Server Remote WebSocket Bridge.*?\s+window\.BackendBridge\.sendIntent\(intentName, payload\);\s*\};\s*/s;
const match1 = jsCode.match(regex1);

// Match Agent Orchestrator
const regex2 = /\/\* ==========================================================\s*6\. AGENT ORCHESTRATOR \(AgentOS Core\).*?\s*return \{ status: 'unsupported', message: 'AI Orchestrator not loaded' \};\s*\}\s*\};\s*/s;
const match2 = jsCode.match(regex2);

if (match1 && match2) {
    fs.writeFileSync(backendFile, match1[0] + '\n\n' + match2[0] + '\n');
    jsCode = jsCode.replace(match1[0], '');
    jsCode = jsCode.replace(match2[0], '');
    fs.writeFileSync(indexFile, jsCode);
    console.log('Extraction and replacement successful.');
} else {
    console.error('Regex match failed:', !!match1, !!match2);
    if (!match1) {
        console.error('Failed to match Backend Bridge block');
    }
    if (!match2) {
        console.error('Failed to match Agent Orchestrator block');
    }
}
