// src/cli/commands/skill.js
const { Command } = require('commander');
const SkillRegistry = require('../../core/skills/SkillRegistry');

module.exports = new Command('skill')
  .description('Manage and execute skills')
  .addCommand(
    new Command('list')
      .description('List available skills')
      .action(async () => {
        const registry = new SkillRegistry();
        await registry.loadFromDirectory('./skills');
        
        console.table(registry.list().map(s => ({
          Name: s.name,
          Version: s.version,
          Description: s.description,
          Tags: s.tags?.join(', ') || '-'
        })));
      })
  )
  .addCommand(
    new Command('run <skill>')
      .description('Execute a skill')
      .option('-p, --param <key=value>', 'Parameters', [])
      .option('--pipe <pipeline>', 'Run as pipeline')
      .action(async (skillName, options) => {
        const registry = new SkillRegistry();
        await registry.loadFromDirectory('./skills');
        
        const lobster = new LobsterShell(registry);
        
        const params = {};
        options.param.forEach(p => {
          const [k, v] = p.split('=');
          params[k] = v;
        });
        
        if (options.pipe) {
          const result = await lobster.pipe(options.pipe, { input: params });
          console.log(JSON.stringify(result, null, 2));
        } else {
          const result = await registry.execute(skillName, params);
          console.log(JSON.stringify(result, null, 2));
        }
      })
  )
  .addCommand(
    new Command('workflow <file>')
      .description('Execute workflow from JSON file')
      .action(async (file) => {
        const fs = require('fs');
        const definition = JSON.parse(fs.readFileSync(file, 'utf8'));
        
        const registry = new SkillRegistry();
        await registry.loadFromDirectory('./skills');
        
        const lobster = new LobsterShell(registry);
        const result = await lobster.workflow(definition);
        
        console.log(JSON.stringify(result, null, 2));
      })
  );
