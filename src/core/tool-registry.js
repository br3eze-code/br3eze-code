/**
 * ToolRegistry — AgentOS Skill & Tool Loader
 *
 * Supports two skill patterns:
 *   1. Per-tool files  → skills/<name>/tools/<tool>.js
 *   2. Monolithic      → skills/<name>/index.js  with execute(toolName, args, ctx)
 *
 * Enhancements over v1:
 *   • Parallel skill loading on startup
 *   • execute(fullName, args, ctx) — permission check + timing + error enrichment
 *   • search(query)               — fuzzy name/description search for LLM routing
 *   • getToolsForLLM()            — OpenAI function-calling schema
 *   • listSkillsTable()           — CLI-friendly skill summary
 *   • Per-tool invocation metrics (count + lastCalledAt)
 *   • Disabled-skill guard on execute()
 */

'use strict';

const fsp = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { logger } = require('./logger');

// ─── Internal helpers ──────────────────────────────────────────────────────────

function syncExists(p) {
  try { fsSync.accessSync(p); return true; } catch { return false; }
}

function syncIsDir(p) {
  try { return fsSync.statSync(p).isDirectory(); } catch { return false; }
}

// ─── ToolRegistry ─────────────────────────────────────────────────────────────

class ToolRegistry {
  constructor(options = {}) {
    this.skillsPath = options.skillsPath || path.join(process.cwd(), 'src/skills');
    this.tools = new Map();   // fullName → ToolEntry
    this.skills = new Map();   // skillName → SkillEntry
    this.hooks = new Map();   // global hooks (future use)
    this.logger = options.logger || logger;
    this._manifestCache = null;
    this._metrics = new Map();   // fullName → { calls, lastCalledAt, errors }
  }

  // ── Loading ─────────────────────────────────────────────────────────────────

  /**
   * Load all skill directories in parallel.
   */
  async loadSkills() {
    this.logger.info(`Loading skills from: ${this.skillsPath}`);
    try {
      const entries = await fsp.readdir(this.skillsPath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

      // Parallel load — failures are isolated per skill
      await Promise.all(dirs.map(name => this.loadSkill(name)));

      this.logger.info(`Loaded ${this.skills.size} skills with ${this.tools.size} tools`);
    } catch (err) {
      this.logger.error('Failed to read skills directory:', err.message);
    }
  }

  /**
   * Load a single skill by directory name.
   * Tries manifest.yaml → manifest.yml → skill.json for the manifest.
   */
  async loadSkill(skillName) {
    const skillPath = path.join(this.skillsPath, skillName);

    // ── Resolve manifest ────────────────────────────────────────────────────
    const manifest = await this._resolveManifest(skillPath, skillName);
    if (!manifest) return false;

    try {
      this.logger.info(`Loading skill: ${manifest.name} v${manifest.version}`);

      const tools = await this._loadTools(skillPath, manifest);
      const hooks = await this._loadHooks(skillPath, manifest.name);

      this.skills.set(manifest.name, {
        manifest,
        tools,
        hooks,
        path: skillPath,
        enabled: true,
        loadedAt: new Date().toISOString(),
      });

      // Run on-enable lifecycle hook
      if (hooks['on-enable']) {
        try { await hooks['on-enable']({ config: manifest.config || {} }); }
        catch (e) { this.logger.error(`on-enable hook failed for ${manifest.name}:`, e.message); }
      }

      this._manifestCache = null;
      return true;
    } catch (err) {
      this.logger.error(`Failed to load skill "${skillName}":`, err.message);
      return false;
    }
  }

  /**
   * Unload a skill and all its tools.
   */
  async unloadSkill(skillName) {
    const skill = this.skills.get(skillName);
    if (!skill) return false;

    if (skill.hooks['on-disable']) {
      try { await skill.hooks['on-disable'](); }
      catch (e) { this.logger.error(`on-disable hook failed for ${skillName}:`, e.message); }
    }

    // Remove tools belonging to this skill
    for (const [name, tool] of this.tools) {
      if (tool.skill === skillName) {
        this.tools.delete(name);
        this._metrics.delete(name);
      }
    }

    this.skills.delete(skillName);
    this._manifestCache = null;
    this.logger.info(`Unloaded skill: ${skillName}`);
    return true;
  }

  /**
   * Hot-reload a skill (unload + load).
   */
  async reloadSkill(skillName) {
    await this.unloadSkill(skillName);
    return this.loadSkill(skillName);
  }

  // ── Execution ───────────────────────────────────────────────────────────────

  /**
   * Execute a tool by its full namespaced name (e.g. "mikrotik.ping").
   *
   * @param {string}  fullName  — "skill.toolName"
   * @param {object}  args      — tool arguments
   * @param {object}  ctx       — call context (userId, channelId, requestId…)
   * @returns {*} tool result
   */
  async execute(fullName, args = {}, ctx = {}) {
    const entry = this.tools.get(fullName);
    if (!entry) throw new ToolNotFoundError(fullName);

    // Guard: skill must be enabled
    const skill = this.skills.get(entry.skill);
    if (skill && !skill.enabled) {
      throw new SkillDisabledError(entry.skill, fullName);
    }

    // Metrics — initialise lazily
    if (!this._metrics.has(fullName)) {
      this._metrics.set(fullName, { calls: 0, errors: 0, lastCalledAt: null, totalMs: 0 });
    }
    const m = this._metrics.get(fullName);
    m.calls++;
    m.lastCalledAt = new Date().toISOString();

    const t0 = Date.now();
    try {
      const result = await entry.handler(args, ctx);
      m.totalMs += Date.now() - t0;
      return result;
    } catch (err) {
      m.errors++;
      // Enrich error with tool context
      err.toolName = fullName;
      err.toolArgs = args;
      this.logger.error(`Tool "${fullName}" failed: ${err.message}`);
      throw err;
    }
  }

  // ── Discovery ───────────────────────────────────────────────────────────────

  /**
   * Fuzzy-search tools by name or description.
   * Useful for LLM routing ("which tool should I call for X?").
   *
   * @param {string} query
   * @param {number} limit  max results (default 10)
   */
  search(query, limit = 10) {
    const q = query.toLowerCase();
    const results = [];

    for (const [fullName, entry] of this.tools) {
      const nameScore = fullName.toLowerCase().includes(q) ? 2 : 0;
      const descScore = (entry.schema?.description || '').toLowerCase().includes(q) ? 1 : 0;
      const score = nameScore + descScore;
      if (score > 0) results.push({ fullName, score, entry });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => ({
        name: r.fullName,
        description: r.entry.schema?.description || '',
        skill: r.entry.skill,
        risk: r.entry.schema?.risk || 'low',
      }));
  }

  // ── Schema helpers ──────────────────────────────────────────────────────────

  /**
   * Return tools in OpenAI function-calling format (works with Gemini too).
   * Optionally filter to a specific skill.
   *
   * @param {string|null} skillFilter  — only include tools from this skill
   */
  getToolsForLLM(skillFilter = null) {
    const out = [];
    for (const [fullName, entry] of this.tools) {
      if (skillFilter && entry.skill !== skillFilter) continue;

      const skill = this.skills.get(entry.skill);
      if (skill && !skill.enabled) continue;

      const params = entry.schema?.parameters;
      const properties = {};
      const required = [];

      if (Array.isArray(params)) {
        for (const p of params) {
          properties[p.name] = { type: p.type || 'string', description: p.description || '' };
          if (p.required) required.push(p.name);
        }
      } else if (params && typeof params === 'object') {
        // Already in JSON-schema object format
        Object.assign(properties, params.properties || {});
        (params.required || []).forEach(r => required.push(r));
      }

      out.push({
        type: 'function',
        function: {
          name: fullName.replace(/\./g, '__'),  // dots → __ for OpenAI compat
          description: entry.schema?.description || fullName,
          parameters: {
            type: 'object',
            properties,
            required,
          },
        },
      });
    }
    return out;
  }

  /**
   * Returns the OpenClaw capability manifest (cached).
   */
  getManifest() {
    if (this._manifestCache) return this._manifestCache;

    const tools = Array.from(this.tools.values()).map(t => ({
      name: t.schema?.name,
      description: t.schema?.description,
      parameters: t.schema?.parameters || [],
      returns: t.schema?.returns || 'any',
      skill: t.skill,
      risk: t.schema?.risk || 'low',
    }));

    this._manifestCache = {
      version: '1.0.0',
      agent: 'AgentOS',
      skills: Array.from(this.skills.keys()),
      tools,
      safety: {
        maxToolsPerRequest: 10,
        allowedOperations: tools.map(t => t.name),
      },
    };

    return this._manifestCache;
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  getTool(name) { return this.tools.get(name); }
  getAllTools() { return Array.from(this.tools.values()); }
  getSkillNames() { return Array.from(this.skills.keys()); }
  getToolCount() { return this.tools.size; }

  getToolsBySkill(skillName) {
    const skill = this.skills.get(skillName);
    return skill ? Array.from(skill.tools.values()) : [];
  }

  getSkillInfo(skillName) {
    const skill = this.skills.get(skillName);
    if (!skill) return null;
    return { ...skill.manifest, toolCount: skill.tools.size, enabled: skill.enabled, loadedAt: skill.loadedAt };
  }

  setSkillEnabled(skillName, enabled) {
    const skill = this.skills.get(skillName);
    if (skill) { skill.enabled = enabled; this._manifestCache = null; }
  }

  /**
   * Per-tool invocation metrics.
   * @param {string|null} toolName  — omit to get all metrics
   */
  getMetrics(toolName = null) {
    if (toolName) return this._metrics.get(toolName) || null;
    const out = {};
    for (const [k, v] of this._metrics) out[k] = { ...v, avgMs: v.calls ? Math.round(v.totalMs / v.calls) : 0 };
    return out;
  }

  /**
   * CLI-friendly skills table.
   * Returns an array of rows suitable for console-table or chalk rendering.
   */
  listSkillsTable() {
    return Array.from(this.skills.values()).map(s => ({
      skill: s.manifest.name,
      version: s.manifest.version || '—',
      tools: s.tools.size,
      enabled: s.enabled ? '✓' : '✗',
      loadedAt: s.loadedAt ? s.loadedAt.slice(11, 19) : '—',
    }));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async _resolveManifest(skillPath, skillName) {
    const candidates = [
      { file: path.join(skillPath, 'manifest.yaml'), type: 'yaml' },
      { file: path.join(skillPath, 'manifest.yml'), type: 'yaml' },
      { file: path.join(skillPath, 'skill.json'), type: 'json' },
    ];
    for (const c of candidates) {
      try {
        await fsp.access(c.file);
        const raw = await fsp.readFile(c.file, 'utf8');
        return c.type === 'yaml' ? yaml.load(raw) : JSON.parse(raw);
      } catch { /* try next */ }
    }
    this.logger.warn(`No manifest found for skill "${skillName}" (checked manifest.yaml / manifest.yml / skill.json)`);
    return null;
  }

  async _loadTools(skillPath, manifest) {
    const tools = new Map();
    if (!manifest.tools?.length) return tools;

    const toolsDir = path.join(skillPath, 'tools');
    const indexPath = path.join(skillPath, 'index.js');
    const hasToolsDir = syncIsDir(toolsDir);
    const hasIndex = syncExists(indexPath);

    // Pre-load the index module once for Pattern-2 skills
    let indexModule = null;
    if (!hasToolsDir && hasIndex) {
      try {
        delete require.cache[require.resolve(indexPath)];
        const Cls = require(indexPath);
        indexModule = typeof Cls === 'function' ? new Cls({}, this.logger) : Cls;
      } catch (err) {
        this.logger.warn(`Skill "${manifest.name}": failed to load index.js — ${err.message}`);
      }
    }

    for (const toolDef of manifest.tools) {
      // ── Pattern 1: per-file tool ──────────────────────────────────────────
      if (hasToolsDir) {
        const toolFile = `${toolDef.name.replace(/\./g, '-')}.js`;
        const toolPath = path.join(toolsDir, toolFile);
        try {
          delete require.cache[require.resolve(toolPath)];
          const mod = require(toolPath);
          const handler = mod.handler || mod.default || mod;
          const entry = { schema: toolDef, handler, skill: manifest.name };
          tools.set(toolDef.name, entry);
          this.tools.set(`${manifest.name}.${toolDef.name}`, entry);
        } catch (err) {
          this.logger.error(`Failed to load tool "${toolDef.name}": ${err.message}`);
        }

        // ── Pattern 2: delegated to index.js ────────────────────────────────
      } else if (indexModule && typeof indexModule.execute === 'function') {
        const tn = toolDef.name;
        const handler = async (args = {}, ctx = {}) => indexModule.execute(tn, args, ctx);
        const entry = { schema: toolDef, handler, skill: manifest.name };
        tools.set(tn, entry);
        this.tools.set(`${manifest.name}.${tn}`, entry);

      } else {
        this.logger.warn(`Skill "${manifest.name}": no tools/ dir and no execute() — skipping "${toolDef.name}"`);
      }
    }

    return tools;
  }

  async _loadHooks(skillPath, skillName) {
    const hooks = {};
    const hooksDir = path.join(skillPath, 'hooks');
    try {
      const files = await fsp.readdir(hooksDir);
      for (const file of files) {
        if (!file.endsWith('.js')) continue;
        const hookPath = path.join(hooksDir, file);
        delete require.cache[require.resolve(hookPath)];
        hooks[path.basename(file, '.js')] = require(hookPath);
      }
    } catch { /* hooks dir is optional */ }
    return hooks;
  }
}

// ─── Custom errors ─────────────────────────────────────────────────────────────

class ToolNotFoundError extends Error {
  constructor(name) {
    super(`Tool not found: "${name}"`);
    this.name = 'ToolNotFoundError';
    this.toolName = name;
  }
}

class SkillDisabledError extends Error {
  constructor(skill, tool) {
    super(`Skill "${skill}" is disabled — cannot execute tool "${tool}"`);
    this.name = 'SkillDisabledError';
    this.skillName = skill;
    this.toolName = tool;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { ToolRegistry, ToolNotFoundError, SkillDisabledError };
