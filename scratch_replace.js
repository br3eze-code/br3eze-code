const fs = require('fs');
let content = fs.readFileSync('onboard.js', 'utf8');

content = content.replace(
    /const \{ getManager \} = require\('\.\/src\/core\/mikrotik'\);\nconst \{ logger \} = require\('\.\/src\/core\/logger'\);/,
    `const { getManager } = require('./src/core/mikrotik');
const { logger } = require('./src/core/logger');
require('dotenv').config();

const AGENTOS_NODE_URL = process.env.AGENTOS_NODE_URL || 'http://192.168.88.100:3000';
const AGENTOS_IP = new URL(AGENTOS_NODE_URL).hostname;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID';`
);

content = content.replace(/http:\/\/192\.168\.88\.100:3000/g, '${AGENTOS_NODE_URL}');
content = content.replace(/192\.168\.88\.100/g, '${AGENTOS_IP}');
content = content.replace(/YOUR_BOT_TOKEN/g, '${TELEGRAM_BOT_TOKEN}');
content = content.replace(/YOUR_NEW_BOT_TOKEN/g, '${TELEGRAM_BOT_TOKEN}');
content = content.replace(/YOUR_CHAT_ID/g, '${TELEGRAM_CHAT_ID}');
content = content.replace(/8785525787:AAHMbh3PifN8B76TGek4XHltnZCay_WhTnc/g, '${TELEGRAM_BOT_TOKEN}');
content = content.replace(/7733493073/g, '${TELEGRAM_CHAT_ID}');

// Fix netwatch script variables and missing '?'
content = content.replace(/https:\/\/api\.telegram\.org\/bot\\\$BOT_TOKEN\/sendMessagechat_id=\\\$CHAT_ID/g, 'https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage\\\\?chat_id=${TELEGRAM_CHAT_ID}');

// Note that onboard.js uses template strings for setupScript. Replacing directly is fine, we just added template expressions.
// BUT we must make sure `setupScript` is a template string. Let's check:
// The code had `const setupScript = \`/interface bridge ... \`;` So template literals are already used!
// So injecting `${AGENTOS_NODE_URL}` inside that string will correctly interpolate the variable.

fs.writeFileSync('onboard.js', content);
console.log('Replacements done');
