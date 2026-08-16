import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import registry from './ToolRegistry.js';
import BaseDomain from '../domains/BaseDomain.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Automatically loads all domains from src/domains.
 *
 * Domain modules are loaded asynchronously so native ESM domain indexes work
 * correctly. CommonJS modules remain compatible through import()'s namespace
 * and default-export normalization.
 */
async function loadAllDomains(config = {}) {
  const domainsDir = path.join(__dirname, '../domains');

  if (!fs.existsSync(domainsDir)) {
    logger.warn('Domains directory not found');
    return;
  }

  const items = fs.readdirSync(domainsDir);

  for (const item of items) {
    const itemPath = path.join(domainsDir, item);
    const stat = fs.statSync(itemPath);

    if (!stat.isDirectory()) continue;

    const indexPath = path.join(itemPath, 'index.js');
    if (!fs.existsSync(indexPath)) continue;

    try {
      const moduleNamespace = await import(pathToFileURL(indexPath).href);
      const domainModule = moduleNamespace.default ?? moduleNamespace;

      if (typeof domainModule.register === 'function') {
        domainModule.register(registry, config[item] || {});
      } else if (
        typeof domainModule === 'function' &&
        domainModule.prototype instanceof BaseDomain
      ) {
        const domainInstance = new domainModule(config[item] || {});
        registry.registerDomain(domainInstance.name || item, domainInstance.getSkills());
      } else {
        logger.warn(`Domain ${item} does not follow a recognized registration pattern`);
      }
    } catch (err) {
      logger.error(`Failed to load domain ${item}: ${err.message}`);
      console.error(err);
    }
  }
}

export default loadAllDomains;
