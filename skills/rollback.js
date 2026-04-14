// skills/rollback.js
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';

export const rollback = {
  name: "rollback",
  description: "List or restore AgentOS self-edit backups. Use to undo bad self-modifications.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "restore", "diff"],
        description: "list=show all backups, restore=rollback file, diff=show changes"
      },
      backup_file: {
        type: "string",
        description: "For restore/diff: e.g. 'skills/ping.js.bak.1728901234'"
      }
    },
    required: ["action"]
  },

  run: async ({ action, backup_file }) => {
    // Find all.bak files AgentOS created
    const backups = await glob('./{skills,agents,knowledge}/**/*.bak.*');

    if (action === 'list') {
      if (backups.length === 0) {
        return { message: "✅ No self-edit backups found. AgentOS hasn't modified itself yet." };
      }

      const list = await Promise.all(backups.map(async (b) => {
        const stat = await fs.stat(b);
        const original = b.replace(/\.bak\.\d+$/, '');
        const timestamp = b.match(/\.bak\.(\d+)$/)[1];
        const date = new Date(parseInt(timestamp)).toISOString();
        return {
          backup: b,
          original,
          date,
          size_kb: (stat.size / 1024).toFixed(1)
        };
      }));

      // Sort newest first
      list.sort((a, b) => b.date.localeCompare(a.date));

      let msg = `📦 *AgentOS Self-Edit Backups*\n\n`;
      list.forEach((b, i) => {
        msg += `**${i + 1}.** \`${b.original}\`\n`;
        msg += ` _Backup: ${b.date}_\n`;
        msg += ` _Size: ${b.size_kb}KB_\n`;
        msg += ` _Restore: \`rollback restore ${b.backup}\`_\n\n`;
      });
      msg += `_Total: ${list.length} backups_`;

      return { success: true, message: msg, backups: list };
    }

    if (action === 'diff') {
      if (!backup_file) throw new Error('Missing backup_file parameter');
      const original = backup_file.replace(/\.bak\.\d+$/, '');

      const [oldCode, newCode] = await Promise.all([
        fs.readFile(backup_file, 'utf8'),
        fs.readFile(original, 'utf8')
      ]);

      // Simple diff - just show lengths and first change
      const diff = `📊 *Diff: ${original}*\n\n**Before:** ${oldCode.length} chars\n**After:** ${newCode.length} chars\n\n**First 500 chars of current:**\n\`\`\`js\n${newCode.slice(0, 500)}\n\`\`\``;

      return { success: true, message: diff };
    }

    if (action === 'restore') {
      if (!backup_file) throw new Error('Missing backup_file parameter');
      if (!backups.includes(backup_file)) throw new Error('Backup file not found');

      const original = backup_file.replace(/\.bak\.\d+$/, '');

      // Create backup of current before restoring
      const safetyBackup = `${original}.bak.pre-restore.${Date.now()}`;
      await fs.copyFile(original, safetyBackup);

      // Restore
      await fs.copyFile(backup_file, original);

      // Log to soul.md
      await fs.appendFile('./knowledge/soul.md',
        `\n## Rollback ${new Date().toISOString()}\nRestored: ${original}\nFrom: ${backup_file}\nSafety backup: ${safetyBackup}\n`
      );

      return {
        success: true,
        message: `✅ *Rolled back*: \`${original}\`\n\nRestored from: \`${backup_file}\`\nSafety backup created: \`${safetyBackup}\`\n\n⚠️ *Restart AgentOS to apply changes.*`,
        restored: original,
        safety_backup: safetyBackup
      };
    }
  }
}
