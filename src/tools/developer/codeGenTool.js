// src/tools/developer/codeGenTool.js
// ==========================================
let skillPromise;

/** Lazy-load the ESM skill without importing model/provider dependencies at module load time. */
async function getSkill() {
  skillPromise ||= import('../../skills/codegen/index.js');
  const module = await skillPromise;
  return module.default || module.CodegenSkill;
}

const codeGenTool = {
  name:        'codegen',
  description: 'Generate code from natural language using the configured AI provider',
  autonomyLevel: 'supervised',

  /**
   * @param {{ prompt: string, language?: string, framework?: string, outputFile?: string }} params
   * @param {object} context
   */
  async execute(params, context = {}) {
        const Skill = await getSkill();
    const skill = typeof Skill === 'function' ? new Skill(context.config || {}, context.logger) : Skill;
    return skill.execute('codegen.generate', params, context);

  }
};

export default codeGenTool;