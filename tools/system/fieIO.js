import fs from "fs";
import path from "path";
import { logger } from "./logger.js";

function resolvePath(filePath) {
    return path.join(process.cwd(), filePath);
}

function ensureDirectory(dirPath) {
    const resolved = resolvePath(dirPath);
    if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
    }
}

function readFile(filePath, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    return fs.readFileSync(resolved, encoding);
}

function writeFile(filePath, data, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    fs.writeFileSync(resolved, data, encoding);
}

function readJson(filePath, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    const data = fs.readFileSync(resolved, encoding);
    return JSON.parse(data);
}

function writeJson(filePath, data, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    const jsonString = JSON.stringify(data, null, 2);
    fs.writeFileSync(resolved, jsonString, encoding);
}

function appendFile(filePath, data, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    fs.appendFileSync(resolved, data, encoding);
}

function deleteFile(filePath) {
    const resolved = resolvePath(filePath);
    fs.unlinkSync(resolved);
}

function fileExists(filePath) {
    const resolved = resolvePath(filePath);
    return fs.existsSync(resolved);
}

function listDirectory(dirPath) {
    const resolved = resolvePath(dirPath);
    return fs.readdirSync(resolved);
}

function getFileSize(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).size;
}

function getFileStats(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved);
}

function getFileModificationTime(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mtime;
}

function getFileAccessTime(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).atime;
}

function getFileCreationTime(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).birthtime;
}

function getFileOwner(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).uid;
}

function getFileGroup(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).gid;
}

function getFilePermissions(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFileOwnerName(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).uid;
}

function getFileGroupName(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).gid;
}

function getFilePermissionsName(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}
export function readFile(filePath, fallback = null) {
    try {
        const fullPath = resolvePath(filePath);

        if (!fs.existsSync(fullPath)) {
            return fallback;
        }

        const data = fs.readFileSync(fullPath, "utf-8");

        return JSON.parse(data);
    } catch (err) {
        logger.error("File read failed", {
            filePath,
            error: err.message
        });

        return fallback;
    }
}

export function writeFile(filePath, data) {
    try {
        const fullPath = resolvePath(filePath);

        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const jsonString = JSON.stringify(data, null, 2);
        fs.writeFileSync(fullPath, jsonString, "utf-8");

        return true;
    } catch (err) {
        logger.error("File write failed", {
            filePath,
            error: err.message
        });

        return false;
    }
}

export function appendJson(filePath, record) {
    try {
        const fullPath = resolvePath(filePath);

        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        let existingData = [];
        if (fs.existsSync(fullPath)) {
            const data = fs.readFileSync(fullPath, "utf-8");
            existingData = JSON.parse(data);
        }

        existingData.push(record);

        const jsonString = JSON.stringify(existingData, null, 2);
        fs.writeFileSync(fullPath, jsonString, "utf-8");

        return true;
    } catch (err) {
        logger.error("File append failed", {
            filePath,
            error: err.message
        });

        return false;
    }
}
const memoryCache = {};

export function setCache(key, value) {
    memoryCache[key] = {
        value,
        time: Date.now()
    };
}

export function getCache(key, ttl = 60000) {
    const item = memoryCache[key];

    if (!item) return null;

    if (Date.now() - item.time > ttl) {
        delete memoryCache[key];
        return null;
    }

    return item.value;
}
