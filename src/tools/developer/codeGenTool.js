import path from 'path';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// src/tools/developer/codeGenTool.js
// ==========================================




const SKILL_PATH = path.join(__dirname, '../../skills/codegen/index.js');

/** Lazy-load the skill so this file is safe to require without deps ready */
function getSkill() {
  return require(SKILL_PATH);
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
    const skill = getSkill();
    return skill.execute(params, context);
  }
};

export default codeGenTool;