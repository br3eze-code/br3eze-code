import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';
import defaultRegistry from './ToolRegistry.js';
import BaseDomain from '../domains/BaseDomain.js';
import { pathToFileURL } from 'node:url';

/**
 * Load every domain into the supplied capability registry.
 * The default registry is retained for backwards compatibility, while
 * bootstrap/runtime callers can inject an isolated registry for testing or
 * multi-runtime use.
 */
async function loadAllDomains(config = {}, registry = defaultRegistry) {
  const domainsDir = path.join(path.dirname(new URL(import.meta.url).pathname), '../domains');

  if (!fs.existsSync(domainsDir)) {
    logger.warn('Domains directory not found');
    return registry;
  }

  for (const item of fs.readdirSync(domainsDir)) {
    const itemPath = path.join(domainsDir, item);
    if (!fs.statSync(itemPath).isDirectory()) continue;

    const indexPath = path.join(itemPath, 'index.js');
    if (!fs.existsSync(indexPath)) continue;

    try {
      const moduleNamespace = await import(pathToFileURL(indexPath).href);
      const domainModule = moduleNamespace.default ?? moduleNamespace;

      if (typeof domainModule.register === 'function') {
        await domainModule.register(registry, config[item] || {});
      } else if (
        typeof domainModule === 'function' &&
        (domainModule === BaseDomain || domainModule.prototype instanceof BaseDomain)
      ) {
        const domainInstance = new domainModule(config[item] || {});
        registry.registerDomain(domainInstance.name || item, domainInstance.getSkills());
      } else if (
        domainModule &&
        typeof domainModule.getSkills === 'function'
      ) {
        registry.registerDomain(domainModule.name || item, domainModule.getSkills());
      } else {
        logger.warn(`Domain ${item} does not follow a recognized registration pattern`);
      }
    } catch (err) {
      logger.error(`Failed to load domain ${item}: ${err.message}`);
    }
  }

  return registry;
}

export default loadAllDomains;
