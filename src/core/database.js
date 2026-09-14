/**
 * Domain-neutral persistence boundary.
 * Concrete stores are registered/injected by the host; the kernel does not
 * import Firebase, SQLite, SQL, or any vendor persistence SDK.
 */
let provider = null;
export function registerDatabaseProvider(next) { if (!next || typeof next.getDatabase !== 'function') throw new TypeError('Database provider must expose getDatabase()'); provider = next; return provider; }
export function clearDatabaseProvider() { provider = null; }
export function getDatabaseProvider() { return provider; }
export async function getDatabase() { if (!provider) { provider = await import('../adapters/persistence/database.js'); } return provider.getDatabase(); }
export class Database { constructor(...args) { this._args = args; this._instance = null; } async initialize() { this._instance = await getDatabase(); return this._instance; } }
export default Database;
