/**
 * Domain-neutral persistence contract.
 *
 * Core/application code uses these primitives only. Concrete providers
 * (Supabase, Firebase, local) implement the same surface.
 */
let provider = null;

const REQUIRED = ['getDatabase', 'get', 'set', 'update', 'delete', 'query'];

function requireProvider() {
  if (!provider) throw new Error('No database provider registered');
  return provider;
}

function assertProvider(next) {
  if (!next || typeof next.getDatabase !== 'function') {
    throw new TypeError('Database provider must expose getDatabase()');
  }
  const missing = REQUIRED.filter((name) => typeof next[name] !== 'function');
  if (missing.length) throw new TypeError(`Database provider missing methods: ${missing.join(', ')}`);
  return next;
}

export function registerDatabaseProvider(next) {
  provider = assertProvider(next);
  return provider;
}
export function clearDatabaseProvider() { provider = null; }
export function getDatabaseProvider() { return provider; }
export async function getDatabase() { return requireProvider().getDatabase(); }

export async function get(resource, id, options) { return requireProvider().get(resource, id, options); }
export async function set(resource, id, data, options) { return requireProvider().set(resource, id, data, options); }
export async function update(resource, id, data, options) { return requireProvider().update(resource, id, data, options); }
export async function remove(resource, id, options) { return requireProvider().delete(resource, id, options); }
export async function query(resource, filters = {}, options = {}) { return requireProvider().query(resource, filters, options); }

export class Database {
  constructor(...args) { this._args = args; this._instance = null; }
  async initialize() { this._instance = await getDatabase(); return this._instance; }
}
export default Database;
