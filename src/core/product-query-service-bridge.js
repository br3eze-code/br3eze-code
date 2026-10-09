import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sdk from '../plugin-sdk/index.js';
import { getSQLite } from './sqlite-db.js';
<<<<<<< HEAD
=======
import { getPersistenceProvider } from './persistence.js';
>>>>>>> origin/main

let cachedService = null;
let attemptedLoad = false;
function compiledServiceUrl() { const candidates = [path.resolve(process.cwd(), 'dist/core/product-query-service.js'), path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist/core/product-query-service.js')]; const file = candidates.find((candidate) => fs.existsSync(candidate)); return file ? pathToFileURL(file).href : null; }
async function loadCompiledService() { const url = compiledServiceUrl(); return url ? import(url) : null; }
async function getProductQueryService() {
<<<<<<< HEAD
  if (cachedService) return cachedService; if (attemptedLoad) return null; attemptedLoad = true;
  const module = await loadCompiledService(); if (!module) return null;
  let sql; try { sql = new module.SqlProductAdapter(await getSQLite()); } catch { sql = undefined; }
  let documentStore; try { documentStore = sdk.hasProvider('document-store') ? sdk.getProvider('document-store') : null; } catch { documentStore = null; }
  let remote; try { if (documentStore) remote = new module.FirebaseProductAdapter(documentStore); } catch { remote = undefined; }
  if (!sql && !remote) return null; cachedService = new module.ProductQueryService({ sql, firebase: remote }); return cachedService;
=======
  if (cachedService) return cachedService;
  if (attemptedLoad) return null;
  attemptedLoad = true;

  const module = await loadCompiledService();
  if (!module) return null;

  let sql;
  try {
    const db = await getSQLite();
    sql = new module.SqlProductAdapter(db);
  } catch {
    sql = undefined;
  }

  let firebase;
  try {
    const persistence = getPersistenceProvider();
    const firestore = persistence?.getFirestore?.();
    if (firestore) firebase = new module.FirebaseProductAdapter(firestore);
  } catch {
    firebase = undefined;
  }

  if (!sql && !firebase) return null;
  cachedService = new module.ProductQueryService({ sql, firebase });
  return cachedService;
>>>>>>> origin/main
}
function resetProductQueryServiceBridge() { cachedService = null; attemptedLoad = false; }
export { getProductQueryService, resetProductQueryServiceBridge };
