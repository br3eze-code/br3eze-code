'use strict';
/**
 * src/kernel/SkillDiscovery.js
 * ─────────────────────────────────────────────────────────────────
 * Asynchronous Skill Discovery Protocol
 *
 * Structural pattern (adapted from the lazy-loading skill-metadata
 * model used by large agent-skill ecosystems): scan skill package
 * directories for lightweight manifests only — never eagerly
 * require() a skill's executable code at boot. Full module load is
 * deferred until the skill is actually invoked ("lazy hydration").
 *
 * This keeps kernel boot O(files) instead of O(require-graph), and
 * isolates a broken/malicious skill's syntax or import errors to the
 * moment it's called, not the moment the process starts.
 *
 * Kernel-side only: zero knowledge of MikroTik, Dahua, payment
 * gateways, or any other Driver. A skill package is just:
 *
 *   skills/<name>/
 *     manifest.json | skill.json   (required — { name, description,
 *                                    version, permissions[], main? })
 *     index.js                     (required unless manifest.main
 *                                    points elsewhere — exports either
 *                                    a function, or { execute(params,
 *                                    context) })
 *
 * Usage:
 *   const discovery = new SkillDiscovery({ roots: ['./skills'] });
 *   await discovery.scan();                 // fast, metadata-only
 *   discovery.list();                       // [{ name, description, ... }]
 *   const result = await discovery.invoke('research.search', params, ctx);
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs').promises;
const path = require('path');

const REQUIRED_MANIFEST_FIELDS = ['name', 'description', 'version', 'permissions'];
const MANIFEST_FILENAMES = ['manifest.json', 'skill.json'];

class SkillDiscoveryError extends Error {
  constructor(message, { skillDir, cause } = {}) {
    super(message);
    this.name = 'SkillDiscoveryError';
    this.skillDir = skillDir;
    if (cause) this.cause = cause;
  }
}

class SkillDiscovery {
  /**
   * @param {Object} options
   * @param {string[]} options.roots - directories to scan for skill packages
   * @param {Function} [options.onError] - called with (SkillDiscoveryError) per-skill failure; scan never throws for individual skill errors
   */
  constructor({ roots = [], onError = null } = {}) {
    this.roots = roots;
    this.onError = onError;
    /** @type {Map<string, { manifest: Object, dir: string, mainPath: string, module: any, loaded: boolean }>} */
    this.index = new Map();
    this._watchers = [];
  }

  /**
   * Scan all configured roots in parallel. Metadata-only — does not
   * require() any skill code. Individual skill failures are isolated
   * via Promise.allSettled and reported through onError; they never
   * abort the overall scan.
   * @returns {Promise<{ discovered: number, failed: number }>}
   */
  async scan() {
    const rootResults = await Promise.allSettled(this.roots.map(root => this._scanRoot(root)));

    let discovered = 0;
    let failed = 0;
    for (const result of rootResults) {
      if (result.status === 'fulfilled') {
        discovered += result.value.discovered;
        failed += result.value.failed;
      } else {
        this._reportError(
          new SkillDiscoveryError(result.reason?.message || 'root scan failed', {
            cause: result.reason,
          })
        );
        failed += 1;
      }
    }
    return { discovered, failed };
  }

  async _scanRoot(root) {
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err) {
      throw new SkillDiscoveryError(`cannot read skill root: ${root}`, {
        skillDir: root,
        cause: err,
      });
    }

    const dirs = entries.filter(e => e.isDirectory()).map(e => path.join(root, e.name));
    const settled = await Promise.allSettled(dirs.map(dir => this._loadManifest(dir)));

    let discovered = 0;
    let failed = 0;
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled' && outcome.value) {
        discovered += 1;
      } else if (outcome.status === 'rejected') {
        this._reportError(outcome.reason);
        failed += 1;
      }
    }
    return { discovered, failed };
  }

  async _loadManifest(dir) {
    let manifestPath = null;
    let raw = null;

    for (const filename of MANIFEST_FILENAMES) {
      const candidate = path.join(dir, filename);
      try {
        raw = await fs.readFile(candidate, 'utf8');
        manifestPath = candidate;
        break;
      } catch (_) {
        // try next filename
      }
    }

    if (!manifestPath) {
      // Not a skill package (no manifest) — silently skip, not an error
      return null;
    }

    let manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (err) {
      throw new SkillDiscoveryError(`invalid JSON in ${manifestPath}`, {
        skillDir: dir,
        cause: err,
      });
    }

    const missing = REQUIRED_MANIFEST_FIELDS.filter(
      f => !(f in manifest) || manifest[f] === undefined || manifest[f] === ''
    );
    if (missing.length) {
      throw new SkillDiscoveryError(
        `${manifestPath} missing required field(s): ${missing.join(', ')}`,
        { skillDir: dir }
      );
    }
    if (!Array.isArray(manifest.permissions)) {
      throw new SkillDiscoveryError(`${manifestPath}: permissions must be an array`, {
        skillDir: dir,
      });
    }

    if (this.index.has(manifest.name)) {
      const existing = this.index.get(manifest.name);
      throw new SkillDiscoveryError(
        `duplicate skill name '${manifest.name}' (already discovered at ${existing.dir})`,
        { skillDir: dir }
      );
    }

    const mainPath = path.resolve(dir, manifest.main || 'index.js');

    this.index.set(manifest.name, {
      manifest,
      dir,
      mainPath,
      module: null,
      loaded: false,
    });

    return manifest;
  }

  /** Lightweight metadata for every discovered skill — safe to inject wholesale into a system prompt. */
  list() {
    return Array.from(this.index.values()).map(entry => ({ ...entry.manifest }));
  }

  has(name) {
    return this.index.has(name);
  }

  manifest(name) {
    return this.index.get(name)?.manifest || null;
  }

  /**
   * Lazily require() a skill's implementation on first use, then cache it.
   * @returns {Promise<{ execute: Function }>}
   */
  async load(name) {
    const entry = this.index.get(name);
    if (!entry) throw new SkillDiscoveryError(`unknown skill: ${name}`);
    if (entry.loaded) return entry.module;

    let mod;
    try {
      // eslint-disable-next-line global-require -- intentional dynamic/lazy require, the whole point of this protocol
      mod = require(entry.mainPath);
    } catch (err) {
      throw new SkillDiscoveryError(`failed to load skill '${name}' from ${entry.mainPath}`, {
        skillDir: entry.dir,
        cause: err,
      });
    }

    const executor = typeof mod === 'function' ? { execute: mod } : mod;
    if (typeof executor.execute !== 'function') {
      throw new SkillDiscoveryError(
        `skill '${name}' does not export a function or an object with execute()`,
        { skillDir: entry.dir }
      );
    }

    entry.module = executor;
    entry.loaded = true;
    return executor;
  }

  /**
   * Convenience: load (if needed) + execute a skill in one call, enforcing
   * that its declared permissions are a subset of the context's granted set.
   * @param {string} name
   * @param {Object} params
   * @param {{ grantedPermissions?: string[] }} context
   */
  async invoke(name, params, context = {}) {
    const entry = this.index.get(name);
    if (!entry) throw new SkillDiscoveryError(`unknown skill: ${name}`);

    if (Array.isArray(context.grantedPermissions)) {
      const missing = entry.manifest.permissions.filter(
        p => !context.grantedPermissions.includes(p)
      );
      if (missing.length) {
        throw new SkillDiscoveryError(
          `skill '${name}' requires ungranted permission(s): ${missing.join(', ')}`,
          { skillDir: entry.dir }
        );
      }
    }

    const skill = await this.load(name);
    return skill.execute(params, context);
  }

  /**
   * Optional hot-reload: watch each root non-recursively for directory
   * add/remove and re-scan. Uses fs.watch (no external dependency).
   * Disabled by default — call explicitly if wanted.
   */
  watch(onChange = () => {}) {
    for (const root of this.roots) {
      try {
        const watcher = require('fs').watch(root, { persistent: false }, async () => {
          this.index.clear();
          const result = await this.scan();
          onChange(result);
        });
        this._watchers.push(watcher);
      } catch (err) {
        this._reportError(
          new SkillDiscoveryError(`cannot watch root: ${root}`, { skillDir: root, cause: err })
        );
      }
    }
    return this;
  }

  unwatch() {
    for (const watcher of this._watchers) watcher.close();
    this._watchers = [];
  }

  _reportError(err) {
    if (typeof this.onError === 'function') {
      this.onError(err);
    }
  }
}

module.exports = { SkillDiscovery, SkillDiscoveryError };