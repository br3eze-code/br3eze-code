// src/cli/commands/skill.js
// ==========================================
// AGENTOS SKILL COMMAND
// List, run, and manage agent skills
// ==========================================

const chalk = require('chalk');
const path  = require('path');

module.exports = (program) => {
  const skill = program
    .command('skill')
    .description('Manage and execute agent skills');

  // ── skill list ────────────────────────────────────────────────────────────
  skill
    .command('list')
    .description('List all installed skills')
    .action(async () => {
      try {
        const SkillRegistry = require('../../core/SkillRegistry');
        const registry = new SkillRegistry({});
        const skillsDir = path.join(process.cwd(), 'src', 'skills');
        await registry.loadFromDirectory(skillsDir);

        const skills = registry.list();
        if (!skills.length) {
          console.log(chalk.yellow('No skills installed. Drop skill folders into src/skills/'));
          return;
        }

        console.log(chalk.cyan(`\n📦 Installed Skills (${skills.length})\n`));
        skills.forEach(name => {
          const s = registry.get(name);
          console.log(`  ${chalk.green('●')} ${chalk.bold(name)} v${s.manifest.version}`);
          console.log(`    ${chalk.gray(s.manifest.description)}\n`);
        });
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
      }
    });

  // ── skill run <name> ───────────────────────────────────────────────────────
  skill
    .command('run <skillName>')
    .description('Execute a skill by name')
    .option('-p, --param <key=value>', 'Pass parameter(s)', (v, prev) => {
      const [k, val] = v.split('=');
      return { ...prev, [k]: val };
    }, {})
    .action(async (skillName, options) => {
      try {
        const SkillRegistry = require('../../core/SkillRegistry');
        const registry = new SkillRegistry({});
        await registry.loadFromDirectory(path.join(process.cwd(), 'src', 'skills'));

        if (!registry.has(skillName)) {
          console.error(chalk.red(`✗ Skill not found: ${skillName}`));
          process.exit(1);
        }

        const skill = registry.get(skillName);
        const result = await skill.execute(options.param, { skill });
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // ── skill info <name> ──────────────────────────────────────────────────────
  skill
    .command('info <skillName>')
    .description('Show skill manifest and parameters')
    .action(async (skillName) => {
      try {
        const SkillRegistry = require('../../core/SkillRegistry');
        const registry = new SkillRegistry({});
        await registry.loadFromDirectory(path.join(process.cwd(), 'src', 'skills'));

        const s = registry.get(skillName);
        if (!s) {
          console.error(chalk.red(`✗ Skill not found: ${skillName}`));
          return;
        }

        console.log(chalk.cyan(`\n📦 ${s.manifest.name} v${s.manifest.version}\n`));
        console.log(chalk.gray(s.manifest.description));
        if (s.manifest.parameters) {
          console.log(chalk.cyan('\nParameters:'));
          Object.entries(s.manifest.parameters).forEach(([k, cfg]) => {
            const req = cfg.required ? chalk.red('*') : ' ';
            console.log(`  ${req} ${chalk.bold(k)} (${cfg.type}) — ${cfg.description || ''}`);
          });
        }
        console.log('');
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
      }
    });
};
