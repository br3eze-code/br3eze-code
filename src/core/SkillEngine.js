
/**
 * SkillEngine — validated skill registry with before/after hooks
 * ─────────────────────────────────────────────────────────────────
 * Existing callers unchanged:
 *   engine.register(name, skill)
 *   engine.skills.get(name)
 *
 * Added: manifest validation before registration.
 * ─────────────────────────────────────────────────────────────────
 */

const REQUIRED_FIELDS = ['name', 'description', 'version', 'permissions'];

class SkillEngine {
  constructor() {
    this.skills = new Map();
    this.hooks  = { beforeExecute: [], afterExecute: [] };
  }

  /**
   * Register a skill. Accepts either:
   *   register(name, skillObj)       — legacy form, name taken from arg
   *   register(manifest, executor)   — new form with full manifest validation
   */
  register(nameOrManifest, skill) {
    // Detect new form: first arg is an object with 'name'
    let manifest, executor;
    if (typeof nameOrManifest === 'object' && nameOrManifest !== null) {
      manifest = nameOrManifest;
      executor = skill;
    } else {
      // Legacy form — wrap into manifest shape
      manifest = { name: nameOrManifest, description: skill.description || '', version: '1.0.0', permissions: [] };
      executor  = skill.execute ? skill : { execute: skill };
    }

    // Validate required manifest fields
    const missing = REQUIRED_FIELDS.filter(f => !(f in manifest) || manifest[f] === undefined || manifest[f] === '');
    if (missing.length) {
      throw new TypeError(`SkillEngine.register('${manifest.name}'): manifest missing: ${missing.join(', ')}`);
    }
    if (typeof (executor.execute || executor) !== 'function') {
      throw new TypeError(`SkillEngine.register('${manifest.name}'): executor must be a function or have execute()`);
    }

    const fn = executor.execute || executor;
    this.skills.set(manifest.name, {
      manifest,
      ...executor,
      execute: this._wrapWithHooks(fn, manifest.name),
    });

    return this;
  }

  _wrapWithHooks(fn, name) {
    return async (params, context) => {
      for (const hook of this.hooks.beforeExecute) await hook(params, context, name);
      const result = await fn(params, context);
      for (const hook of this.hooks.afterExecute)  await hook(result, context, name);
      return result;
    };
  }

  // Hook registration
  before(fn) { this.hooks.beforeExecute.push(fn); return this; }
  after(fn)  { this.hooks.afterExecute.push(fn);  return this; }

  has(name)   { return this.skills.has(name); }
  list()      { return Array.from(this.skills.values()).map(s => s.manifest || { name: s.name }); }

  async execute(name, params, context) {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    return skill.execute(params, context);
  }
}

export default SkillEngine;
