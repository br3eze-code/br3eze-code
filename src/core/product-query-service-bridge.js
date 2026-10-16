import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getSQLite } from './sqlite-db.js';
import { getFirestore } from './firebase.js';

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
  if (!url) return null;
  return import(url);
}

async function getProductQueryService() {
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
    const firestore = getFirestore();
    if (firestore) firebase = new module.FirebaseProductAdapter(firestore);
  } catch {
    firebase = undefined;
  }

  if (!sql && !firebase) return null;
  cachedService = new module.ProductQueryService({ sql, firebase });
  return cachedService;
}

function resetProductQueryServiceBridge() {
  cachedService = null;
  attemptedLoad = false;
}

export { getProductQueryService, resetProductQueryServiceBridge };
