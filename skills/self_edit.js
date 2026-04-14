// skills/self_edit.js
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const SAFE_DIRS = ['./skills', './agents', './knowledge']; // Can only edit these
const FORBIDDEN = ['/system', '/etc', 'package.json', 'node_modules']; // Never touch

export const self_edit = {
  name: "self_edit",
  description: "CRITICAL: Modify AgentOS source files to fix bugs or add features. Use after 2+ failures or when soul.md permits self-improvement.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", description: "Path like 'skills/ping.js' or 'agents/ask-engine.js'" },
      reason: { type: "string", description: "Why editing: 'Fix timeout bug', 'Add retry logic'" },
      operation: { type: "string", enum: ["replace", "append", "create"] },
      code: { type: "string", description: "Full file content for replace/create, or snippet for append" }
    },
    required: ["file", "reason", "operation", "code"]
  },

  run: async ({ file, reason, operation, code }, { logger, gemini }) => {
    // Safety check 1: soul.md must allow self-editing
    const soul = await fs.readFile('./knowledge/soul.md', 'utf8');
    if (!soul.includes('Self-Improvement Protocol') && !soul.includes('self_edit enabled')) {
      throw new Error('Blocked by soul.md: self_edit not authorized. User must enable in soul.md first.');
    }

    // Safety check 2: path validation
    const absPath = path.resolve(file);
    const isSafe = SAFE_DIRS.some(dir => absPath.startsWith(path.resolve(dir)));
    const isForbidden = FORBIDDEN.some(bad => absPath.includes(bad));

    if (!isSafe || isForbidden) {
      throw new Error(`Blocked: Cannot edit ${file}. Outside safe dirs or in forbidden list.`);
    }

    // Safety check 3: Ask Gemini to review the edit for destructiveness
    const review = await gemini.generate({
      prompt: `Review this self-edit for AgentOS. Is it safe? Does it violate 'Never break the network' from soul.md?

File: ${file}
Reason: ${reason}
Operation: ${operation}
Code:
${code.slice(0, 2000)}

Reply: SAFE or UNSAFE: <reason>`
    });

    if (!review.text.includes('SAFE')) {
      throw new Error(`Blocked by Gemini safety review: ${review.text}`);
    }

    // Backup before edit
    const backup = `${file}.bak.${Date.now()}`;
    try {
      await fs.copyFile(absPath, backup);
    } catch { } // File might not exist if creating

    // Perform edit
    if (operation === 'replace' || operation === 'create') {
      await fs.writeFile(absPath, code);
    } else if (operation === 'append') {
      await fs.appendFile(absPath, '\n' + code);
    }

    // Log the self-modification
    await fs.appendFile('./knowledge/soul.md', 
      `\n## Self-Edit ${new Date().toISOString()}\nFile: ${file}\nReason: ${reason}\nBackup: ${backup}\n`
    );

    // Try to validate syntax if .js
    if (file.endsWith('.js')) {
      try {
        execSync(`node --check ${absPath}`);
      } catch (e) {
        // Rollback on syntax error
        await fs.copyFile(backup, absPath);
        throw new Error(`Syntax error in self-edit. Rolled back. ${e.message}`);
      }
    }

    logger.info(`SELF_EDIT: ${file} modified. Reason: ${reason}`);
    return { 
      success: true, 
      file, 
      backup, 
      warning: 'AgentOS modified its own code. Restart may be required.' 
    };
  }
}
