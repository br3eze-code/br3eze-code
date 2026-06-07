// src/domains/files/index.js
const BaseDomain = require('../BaseDomain');
const { logger } = require('../../core/logger');
const fs = require('fs/promises');
const path = require('path');
const { STATE_PATH } = require('../../core/config');

class FilesDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'files';
    this.filesRoot = path.join(STATE_PATH, 'files');
    
    this.initialize();

    this.registerTool({
      name: 'listFiles',
      description: 'List files in the specified directory within the AgentOS files storage.',
      execute: async (directoryPath = '') => {
        const targetDir = path.join(this.filesRoot, directoryPath);
        logger.info(`[FilesDomain] Listing files in ${targetDir}`);
        
        try {
          const entries = await fs.readdir(targetDir, { withFileTypes: true });
          const files = entries.map(entry => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: 0, // Would need stat for this
            path: path.join(directoryPath, entry.name)
          }));
          return { success: true, directory: directoryPath, files };
        } catch (error) {
          logger.error(`[FilesDomain] listFiles error: ${error.message}`);
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'readFile',
      description: 'Read the contents of a file.',
      execute: async (filePath) => {
        const targetPath = path.join(this.filesRoot, filePath);
        logger.info(`[FilesDomain] Reading file: ${targetPath}`);
        
        try {
          const content = await fs.readFile(targetPath, 'utf8');
          return { success: true, path: filePath, content };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
      name: 'deleteFile',
      description: 'Delete a file or directory.',
      execute: async (filePath) => {
        const targetPath = path.join(this.filesRoot, filePath);
        logger.info(`[FilesDomain] Deleting: ${targetPath}`);
        
        try {
          await fs.rm(targetPath, { recursive: true, force: true });
          return { success: true, deleted: filePath };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });

    this.registerTool({
        name: 'getFileInfo',
        description: 'Get detailed information about a file.',
        execute: async (filePath) => {
            const targetPath = path.join(this.filesRoot, filePath);
            try {
                const stats = await fs.stat(targetPath);
                return {
                    success: true,
                    path: filePath,
                    size: stats.size,
                    createdAt: stats.birthtime,
                    modifiedAt: stats.mtime,
                    isDirectory: stats.isDirectory()
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    });

    this.registerTool({
      name: 'writeFile',
      description: 'Write content to a file.',
      execute: async (filePath, content) => {
        const targetPath = path.join(this.filesRoot, filePath);
        logger.info(`[FilesDomain] Writing file: ${targetPath}`);
        
        try {
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, 'utf8');
          return { success: true, path: filePath };
        } catch (error) {
          return { success: false, error: error.message };
        }
      }
    });
  }


  async initialize() {
    try {
      await fs.mkdir(this.filesRoot, { recursive: true });
      logger.info(`[FilesDomain] Storage initialized at ${this.filesRoot}`);
    } catch (error) {
      logger.error(`[FilesDomain] Initialization failed: ${error.message}`);
    }
  }
}

module.exports = FilesDomain;

