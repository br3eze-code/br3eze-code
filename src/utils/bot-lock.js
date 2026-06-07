'use strict';
const fs = require('fs');
const path = require('path');
const { logger } = require('../core/logger');
const { STATE_PATH } = require('../core/config');

const LOCK_FILE = path.join(STATE_PATH, '.telegram_bot.lock');

/**
 * Atomic singleton lock for Telegram bot polling
 * @returns {boolean} true if lock acquired, false otherwise
 */
function acquireBotLock() {
    try {
        if (!fs.existsSync(STATE_PATH)) {
            fs.mkdirSync(STATE_PATH, { recursive: true });
        }

        try {
            const fd = fs.openSync(LOCK_FILE, 'wx');
            fs.writeSync(fd, process.pid.toString());
            fs.closeSync(fd);

            // Register process exit handler for cleanup
            process.on('exit', () => releaseBotLock());
            process.on('SIGINT', () => process.exit(0)); // Ensure exit handlers run
            process.on('SIGTERM', () => process.exit(0));

            return true;
        } catch (err) {
            if (err.code === 'EEXIST') {
                const pidStr = fs.readFileSync(LOCK_FILE, 'utf8').trim();
                const pid = parseInt(pidStr, 10);
                if (pid === process.pid) return true;

                try {
                    process.kill(pid, 0);
                    logger.warn(`Telegram Bot: 409 Prevented. Already running in PID ${pid}.`);
                    return false;
                } catch (e) {
                    logger.info(`Telegram Bot: stale lock for PID ${pid}, cleaning up...`);
                    try { fs.unlinkSync(LOCK_FILE); } catch (_) { }
                    return acquireBotLock(); // Recursive retry after cleanup
                }
            }
            throw err;
        }
    } catch (err) {
        logger.error(`Telegram Bot: lock failed: ${err.message}`);
        return false;
    }
}

/**
 * Release the bot lock if owned by current process
 */
function releaseBotLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const pid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
            if (pid === process.pid.toString()) {
                fs.unlinkSync(LOCK_FILE);
                logger.debug('Telegram Bot: lock file released');
            }
        }
    } catch (e) {
        // Silently ignore cleanup errors
    }
}

module.exports = { acquireBotLock, releaseBotLock };
