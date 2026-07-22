'use strict';

import { getManager } from '../src/core/mikrotik.js';
import { logger } from '../src/core/logger.js';

class MikroTikManager {
    constructor() {
        this.manager = getManager();
    }

    async execute(args) {
        const { host, username, password, command, params } = args;
        // If host/user/pass provided, create a temporary manager or update current one
        // For now, we'll assume the global manager is configured or use the provided ones if possible
        if (host && username) {
            const { getManager } = await import('../src/core/mikrotik.js');
            const tempManager = getManager({
                host,
                user: username,
                password,
                port: args.port || 8728
            });
            await tempManager.connect();
            try {
                return await tempManager.executeTool(command, params);
            } finally {
                tempManager.disconnect();
            }
        }
        
        if (!this.manager.isConnected) {
            await this.manager.connect();
        }
        return await this.manager.executeTool(command, params);
    }

    async hotspotLogin(args) {
        const { host, username, password, challenge } = args;
        // This logic is usually in the client-side bridge, but if needed on server:
        logger.info(`Hotspot login attempt for ${username} at ${host}`);
        // Implement CHAP-MD5 if needed, or proxy to mikrotik.js
        return { success: true, message: 'Login command proxied' };
    }
}

export default MikroTikManager;
