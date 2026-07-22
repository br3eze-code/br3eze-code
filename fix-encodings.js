const fs = require('fs');
let c = fs.readFileSync('src/cli/commands/onboard.js', 'utf8');

const replacements = [
  [/â”€/g, '─'],
  [/ðŸš€/g, '🚀'],
  [/â€”/g, '—'],
  [/ðŸ“±/g, '📱'],
  [/ðŸŽ®/g, '🎮'],
  [/ðŸ’¬/g, '💬'],
  [/ðŸ§ /g, '🧠'],
  [/ðŸŒ /g, '🌐'],
  [/â€¦/g, '…'],
  [/âœ“/g, '✓'],
  [/âœ—/g, '✗'],
  [/ðŸ“¡/g, '📡'],
  [/ðŸ“¹/g, '📹'],
  [/ðŸ”¥/g, '🔥'],
  [/ðŸ“‹/g, '📋'],
  [/ðŸ’³/g, '💳'],
  [/ðŸ¤–/g, '🤖'],
  [/âš /g, '⚠']
];

for (const [regex, replacement] of replacements) {
  c = c.replace(regex, replacement);
}

fs.writeFileSync('src/cli/commands/onboard.js', c, 'utf8');
console.log('Fixed encodings in onboard.js');
