const registry = require('./ToolRegistry');
const mikrotikDomain = require('../domains/mikrotik');

async function loadDomains(config) {
  // Load MikroTik
  registry.registerDomain('mikrotik', mikrotikDomain.getSkills(config));

  // Easy to add more:
  // const linuxDomain = require('../domains/linux');
  // registry.registerDomain('linux', linuxDomain.getSkills(config));

  console.log(`Loaded domains: ${Array.from(registry.domains.keys()).join(', ')}`);
}

module.exports = loadDomains;
