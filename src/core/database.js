/**
 * Domain-neutral persistence boundary.
 * Concrete stores are registered by the host; Core never imports them.
 */
let provider = null;

function requireProvider() {
  if (!provider) throw new Error('No database provider registered');
  return provider;
}

export function registerDatabaseProvider(next) {
  if (!next || typeof next.getDatabase !== 'function') throw new TypeError('Database provider must expose getDatabase()');
  provider = next;
  return provider;
}
export function clearDatabaseProvider() { provider = null; }
export function getDatabaseProvider() { return provider; }
export async function getDatabase() { return requireProvider().getDatabase(); }

export class Database {
  constructor(...args) { this._args = args; this._instance = null; }
  async initialize() { this._instance = await getDatabase(); return this._instance; }
}
export default Database;
