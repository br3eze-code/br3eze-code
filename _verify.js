const checks = [
  ['gateway CLI',       './src/cli/commands/gateway'],
  ['TelegramChannel',   './src/core/channels/TelegramChannel'],
  ['ChannelManager',    './src/core/channels/ChannelManager'],
  ['core/gateway',      './src/core/gateway'],
  ['gateway-engine',    './src/core/gateway-engine'],
  ['onboard',           './src/cli/commands/onboard'],
  ['universal-billing', './src/core/universal-billing'],
];

let pass = 0, fail = 0;
for (const [label, mod] of checks) {
  try {
    require(mod);
    console.log('[PASS] ' + label);
    pass++;
  } catch(e) {
    console.error('[FAIL] ' + label + ': ' + e.message);
    fail++;
  }
}
console.log('-----');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
