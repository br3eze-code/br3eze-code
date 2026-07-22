// src/core/loadDomain.js
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { logger } from './logger.js';
import registry from './ToolRegistry.js';
import BaseDomain from '../domains/BaseDomain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Automatically loads all domains from src/domains
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

    if (stat.isDirectory()) {
      const indexPath = path.join(itemPath, 'index.js');
      if (fs.existsSync(indexPath)) {
        try {
          const imported = await import(pathToFileURL(indexPath).href);
          const domainModule = imported.default !== undefined ? imported.default : imported;
          
          if (typeof domainModule.register === 'function') {
            // Functional registration pattern
            domainModule.register(registry, config[item] || {});
          } else if (typeof domainModule === 'function' && domainModule.prototype instanceof BaseDomain) {
            // Class registration pattern
            const DomainClass = domainModule;
            const domainInstance = new DomainClass(config[item] || {});
            registry.registerDomain(domainInstance.name || item, domainInstance.getSkills());
          } else {
            logger.warn(`Domain ${item} does not follow a recognized registration pattern`);
          }
        } catch (err) {
          logger.error(`Failed to load domain ${item}: ${err.message}`);
          console.error(err); // Show stack trace for debugging
        }
      }
    }
  }
}

export default loadAllDomains;
