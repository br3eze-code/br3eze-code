// src/core/memory/adapters/ObsidianAdapter.js
const fs = require('fs/promises');
const path = require('path');

class ObsidianAdapter {
  constructor() {
    const { getConfig } = require('../../config');
    const config = getConfig();
    this.vaultPath = config.obsidian?.vaultPath || path.join(process.cwd(), 'vault');
  }

  async initialize() {
    try {
      await fs.mkdir(this.vaultPath, { recursive: true });
    } catch (e) {
      // Ignored
    }
  }

  /**
   * Resolve a key to a hierarchical path in the Obsidian vault.
   * key: "user:123:context" -> vault/user/123/context.md
   */
  _getKeyPath(key) {
    const parts = key.split(':').map(p => p.replace(/[^a-zA-Z0-9_-]/g, '_'));
    if (parts.length === 1) {
      return path.join(this.vaultPath, `${parts[0]}.md`);
    }
    
    const fileName = parts.pop();
    const dirPath = path.join(this.vaultPath, ...parts);
    return {
      dir: dirPath,
      file: path.join(dirPath, `${fileName}.md`)
    };
  }

  async get(key) {
    try {
      const target = this._getKeyPath(key);
      const filePath = typeof target === 'string' ? target : target.file;
      
      const content = await fs.readFile(filePath, 'utf8');
      
      // Parse History if present
      if (content.includes('## History')) {
        const match = content.match(/## History\n\n([\s\S]*)/);
        if (match) {
          const lines = match[1].trim().split('\n').filter(l => l.trim());
          return lines.map(l => {
            const data = l.replace(/^\d+\.\s+/, '');
            try { return JSON.parse(data); } catch (e) { return data; }
          });
        }
      }
      
      // Parse JSON block if present
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }
      
      return null;
    } catch (e) {
      return null;
    }
  }

  async set(key, value, ttlSeconds = null) {
    const isArray = Array.isArray(value);
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    
    let md = `---\ntype: memory\nkey: ${key}\nupdatedAt: ${new Date().toISOString()}\n`;
    if (ttlSeconds) md += `ttl: ${ttlSeconds}\n`;
    md += `---\n\n`;
    
    if (isArray) {
      md += `## History\n\n`;
      value.forEach((item, i) => {
        const itemStr = typeof item === 'object' ? JSON.stringify(item) : item;
        md += `${i + 1}. ${itemStr}\n`;
      });
    } else {
      md += `\`\`\`json\n${content}\n\`\`\``;
    }

    const target = this._getKeyPath(key);
    const filePath = typeof target === 'string' ? target : target.file;
    const dirPath = typeof target === 'string' ? path.dirname(target) : target.dir;

    await fs.mkdir(dirPath, { recursive: true });

    // Atomic write using temp file
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, md, 'utf8');
    await fs.rename(tempPath, filePath);
  }

  async push(key, value) {
    const data = await this.get(key);
    const arr = Array.isArray(data) ? data : (data ? [data] : []);
    arr.push(value);
    await this.set(key, arr);
  }

  async trim(key, count) {
    const arr = (await this.get(key)) || [];
    if (count < 0) {
      await this.set(key, arr.slice(count));
    } else {
      await this.set(key, arr.slice(0, count));
    }
  }

  async delete(key) {
    try {
      const target = this._getKeyPath(key);
      const filePath = typeof target === 'string' ? target : target.file;
      await fs.unlink(filePath);
      return true;
    } catch (e) {
      return false;
    }
  }

  async list(prefix = '') {
    // Basic implementation to list files starting with a prefix
    // In a hierarchical system, this could be improved to walk the tree
    const results = [];
    const walk = async (dir, currentKey = '') => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const nameWithoutExt = entry.name.replace(/\.md$/, '');
        const keyPart = currentKey ? `${currentKey}:${nameWithoutExt}` : nameWithoutExt;
        
        if (entry.isDirectory()) {
          await walk(fullPath, keyPart);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          if (!prefix || keyPart.startsWith(prefix)) {
            results.push(keyPart);
          }
        }
      }
    };

    try {
      await walk(this.vaultPath);
    } catch (e) {
      // Ignored
    }
    return results;
  }

  async close() {
    // No-op
  }

  getStatus() {
    return {
      type: 'obsidian',
      vaultPath: this.vaultPath
    };
  }
}

module.exports = ObsidianAdapter;

