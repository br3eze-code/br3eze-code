/** Backward-compatible shim for the domain-neutral database port. */
export {
  registerDatabaseProvider,
  clearDatabaseProvider,
  getDatabaseProvider,
  getDatabase
} from './ports/database.js';

import { getDatabase } from './ports/database.js';
export class Database {
  constructor(...args) { this._args = args; this._instance = null; }
  async initialize() { this._instance = await getDatabase(); return this._instance; }
}
export default Database;
