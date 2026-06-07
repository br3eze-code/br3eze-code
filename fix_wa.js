const fs = require('fs');
const file = './src/core/channels/WhatsappChannel.js';
let src = fs.readFileSync(file, 'utf8');
const before = src;
src = src
  .replace("BaseChannel.register('whatsapp', WhatsappChannel);", "BaseChannel.register('whatsapp', WhatsAppChannel);")
  .replace('module.exports = WhatsappChannel;', 'module.exports = WhatsAppChannel;');
if (src === before) {
  console.log('No changes needed — already correct or pattern not found');
} else {
  fs.writeFileSync(file, src, 'utf8');
  console.log('Done. Patched WhatsappChannel → WhatsAppChannel');
}
