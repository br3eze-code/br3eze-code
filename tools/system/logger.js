// tools/system/logger.js
// AgentOS Logging Core — CJS

'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');

if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const timestamp = () => new Date().toISOString();

const LEVELS = {
    ERROR: 'ERROR',
    WARN:  'WARN',
    INFO:  'INFO',
    DEBUG: 'DEBUG',
    SUCCESS: 'SUCCESS'
};

const COLORS = {
    [LEVELS.ERROR]:   '\x1b[31m',
    [LEVELS.WARN]:    '\x1b[33m',
    [LEVELS.INFO]:    '\x1b[36m',
    [LEVELS.DEBUG]:   '\x1b[34m',
    [LEVELS.SUCCESS]: '\x1b[32m',
    reset: '\x1b[0m'
};

function logToFile(level, message, data = null) {
    const filename = path.join(LOG_DIR, `${level.toLowerCase()}.log`);
    const line = `${timestamp()} [${level}] ${message}${data ? ' | ' + JSON.stringify(data) : ''}\n`;
    try { fs.appendFileSync(filename, line); } catch (_) {}
}

function logToConsole(level, message, data = null) {
    if (process.env.NODE_ENV === 'production') return;
    const color = COLORS[level] || COLORS[LEVELS.INFO];
    const reset = COLORS.reset;
    console.log(`${color}[${timestamp()}] [${level}]${reset} ${message}`);
    if (data) console.log(color + JSON.stringify(data, null, 2) + reset);
}

const logger = {
    error:   (message, data = null) => { logToFile(LEVELS.ERROR,   message, data); logToConsole(LEVELS.ERROR,   message, data); },
    warn:    (message, data = null) => { logToFile(LEVELS.WARN,    message, data); logToConsole(LEVELS.WARN,    message, data); },
    info:    (message, data = null) => { logToFile(LEVELS.INFO,    message, data); logToConsole(LEVELS.INFO,    message, data); },
    debug:   (message, data = null) => { logToFile(LEVELS.DEBUG,   message, data); logToConsole(LEVELS.DEBUG,   message, data); },
    success: (message, data = null) => { logToFile(LEVELS.SUCCESS, message, data); logToConsole(LEVELS.SUCCESS, message, data); },

    log(level, message, data = null) {
        if (LEVELS[level]) {
            logToFile(level, message, data);
            logToConsole(level, message, data);
        } else {
            logger.error(`Unknown log level: ${level}`);
        }
    },

    clear() {
        Object.values(LEVELS).forEach(level => {
            const filename = path.join(LOG_DIR, `${level.toLowerCase()}.log`);
            if (fs.existsSync(filename)) fs.writeFileSync(filename, '');
        });
        logger.info('Logs cleared');
    },

    getLogs(level) {
        const filename = path.join(LOG_DIR, `${level.toLowerCase()}.log`);
        return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
    }
};

module.exports = { logger };
