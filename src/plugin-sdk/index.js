'use strict';
/**
 * AgentOS Plugin SDK
 * The ONLY surface plugins are allowed to import from core.
 * domains/, adapters/, channels/ reach no further than this file.
 * core/ imports nothing from domains/ or adapters/.
 */

const _domains   = new Map();
const _channels  = new Map();
const _providers = new Map();
const _skills    = new Map();

const SKILL_REQUIRED = ['name', 'description', 'version', 'permissions'];

// ── Domain ──────────────────────────────────────────────────────────────────
function registerDomain(id, adapter) {
  if (!id || typeof id !== 'string')
    throw new TypeError('registerDomain: id must be a non-empty string');
  if (typeof adapter.getCapabilities !== 'function')
    throw new TypeError(`registerDomain(${id}): adapter must implement getCapabilities()`);
  const entry = { adapter, health: 'unknown', capabilities: adapter.getCapabilities() };
  _domains.set(id, entry);
  return entry;
}
const getDomain   = (id) => _domains.get(id);
const hasDomain   = (id) => _domains.has(id);
const listDomains = ()   => [..._domains.entries()].map(([id, d]) => ({ id, ...d }));

// ── Channel ─────────────────────────────────────────────────────────────────
function registerChannel(id, factory) {
  if (!id || typeof factory !== 'function')
    throw new TypeError('registerChannel: id (string) and factory (fn) required');
  _channels.set(id, factory);
}
const getChannel   = (id) => _channels.get(id);
const listChannels = ()   => [..._channels.keys()];

// ── Provider ─────────────────────────────────────────────────────────────────
function registerProvider(id, factory) {
  if (!id || typeof factory !== 'function')
    throw new TypeError('registerProvider: id (string) and factory (fn) required');
  _providers.set(id, factory);
}
function getProvider(id, config) {
  const f = _providers.get(id);
  if (!f) throw new Error(`No provider '${id}'. Known: ${[..._providers.keys()].join(', ')}`);
  return f(config);
}
const listProviders = () => [..._providers.keys()];
const hasProvider   = (id) => _providers.has(id);

// ── Skill ───────────────────────────────────────────────────────────────────
function registerSkill(manifest, executor) {
  const missing = SKILL_REQUIRED.filter(
    (f) => !(f in manifest) || manifest[f] === '' || manifest[f] === undefined
  );
  if (missing.length)
    throw new TypeError(
      `registerSkill('${manifest.name}'): missing fields: ${missing.join(', ')}`
    );
  if (typeof executor !== 'function')
    throw new TypeError(`registerSkill('${manifest.name}'): executor must be a function`);
  _skills.set(manifest.name, { manifest, executor });
}
const getSkill   = (name) => _skills.get(name);
const listSkills = ()     => [..._skills.values()].map((s) => s.manifest);
const hasSkill   = (name) => _skills.has(name);

// ── Snapshot ─────────────────────────────────────────────────────────────────
const snapshot = () => ({
  domains:   listDomains(),
  channels:  listChannels(),
  providers: listProviders(),
  skills:    listSkills(),
});

module.exports = {
  registerDomain, getDomain, hasDomain, listDomains,
  registerChannel, getChannel, listChannels,
  registerProvider, getProvider, listProviders, hasProvider,
  registerSkill, getSkill, listSkills, hasSkill,
  snapshot,
};