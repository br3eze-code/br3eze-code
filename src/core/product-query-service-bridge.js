import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sdk from '../plugin-sdk/index.js';
import { getSQLite } from './sqlite-db.js';
import { getPersistenceProvider } from './persistence.js';

let cachedService = null;
let attemptedLoad = false;

function compiledServiceUrl() {
  const candidates = [
    path.resolve(process.cwd(), 'dist/core/product-query-service.js'),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist/core/product-query-service.js'),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  return file ? pathToFileURL(file).href : null;
}

async function loadCompiledService() {
  const url = compiledServiceUrl();
  return url ? import(url) : null;
}

async function getProductQueryService() {
  if (cachedService) return cachedService;
  if (attemptedLoad) return null;
  attemptedLoad = true;

  const module = await loadCompiledService();
  if (!module) return null;

  // Core asks the persistence port first; legacy adapters remain as a
  // compatibility fallback until all hosts register the port directly.
  const persistence = getPersistenceProvider();
  let sql;
  try {
    const database = persistence?.getSQLite
      ? await persistence.getSQLite()
      : await getSQLite();
    sql = new module.SqlProductAdapter(database);
  } catch {
    sql = undefined;
  }

  let remote;
  try {
    const documentStore = persistence?.getDocumentStore
      ? await persistence.getDocumentStore()
      : (sdk.hasProvider('document-store') ? sdk.getProvider('document-store') : null);
    if (documentStore) remote = new module.FirebaseProductAdapter(documentStore);
  } catch {
    remote = undefined;
  }

  if (!sql && !remote) return null;
  cachedService = new module.ProductQueryService({ sql, firebase: remote });
  return cachedService;
}

function resetProductQueryServiceBridge() {
  cachedService = null;
  attemptedLoad = false;
}

export { getProductQueryService, resetProductQueryServiceBridge };
