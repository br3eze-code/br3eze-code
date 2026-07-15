// src/tools/developer/codeGenTool.js
// ==========================================


'use strict';

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILL_PATH = path.join(__dirname, '../../skills/codegen/index.js');

/** Lazy-load the skill so this file is safe to require without deps ready */
async function getSkill() {
  return (await import(pathToFileURL(SKILL_PATH).href)).default;
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
