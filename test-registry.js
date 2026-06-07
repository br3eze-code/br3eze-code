const SkillRegistry = require('./src/core/skills/SkillRegistry');

async function test() {
  try {
    const registry = new SkillRegistry();
    const path = require('path');
    await registry.loadFromDirectory(path.resolve('./skills'));
    console.log("Loaded skills:", registry.list().map(m => m.name));

    console.log("Calling via registry...");
    const result = await registry.execute('calendar', 'calendar', { action: 'list' });
    console.log("Result:", result);
  } catch(e) {
    console.error("Error:", e);
  }
}
test();
