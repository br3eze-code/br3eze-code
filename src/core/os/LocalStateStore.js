import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;
const MAX_VALUE_BYTES = 1024 * 1024;

function assertName(value, label) {
  if (typeof value !== 'string' || !NAME.test(value) || value === '.' || value === '..') throw new TypeError(`${label} must be a safe identifier`);
}

function validateJson(value, depth = 0) {
  if (depth > 32) throw new TypeError('state value exceeds maximum nesting depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) validateJson(item, depth + 1); return; }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('state value must be JSON-compatible data');
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('unsafe state object key');
    validateJson(item, depth + 1);
  }
}

/** Durable, local-first key/value state. Synchronization is deliberately a separate future adapter. */
export class LocalStateStore {
  constructor({ rootDir = path.join(os.homedir(), '.br3eze-os', 'state'), maxValueBytes = MAX_VALUE_BYTES } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new TypeError('rootDir is required');
    if (!Number.isInteger(maxValueBytes) || maxValueBytes < 1 || maxValueBytes > 64 * 1024 * 1024) throw new RangeError('maxValueBytes must be between 1 byte and 64 MiB');
    this.rootDir = path.resolve(rootDir);
    this.maxValueBytes = maxValueBytes;
  }

  async get({ tenantId, appId, key } = {}) {
    const file = this.#file({ tenantId, appId, key });
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw).value;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async set({ tenantId, appId, key, value } = {}) {
    const file = this.#file({ tenantId, appId, key });
    validateJson(value);
    const serialized = JSON.stringify({ value, updatedAt: new Date().toISOString() });
    if (Buffer.byteLength(serialized, 'utf8') > this.maxValueBytes) throw new RangeError('state value exceeds configured size limit');
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${cryptoRandomId()}.tmp`;
    try {
      await fs.writeFile(temp, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
    return { tenantId, appId, key, bytes: Buffer.byteLength(serialized, 'utf8') };
  }

  async delete({ tenantId, appId, key } = {}) {
    const file = this.#file({ tenantId, appId, key });
    try { await fs.unlink(file); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }

  async list({ tenantId, appId } = {}) {
    assertName(tenantId, 'tenantId'); assertName(appId, 'appId');
    const dir = path.join(this.rootDir, tenantId, appId);
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -5)).filter((key) => NAME.test(key)).sort();
  }

  #file({ tenantId, appId, key } = {}) {
    assertName(tenantId, 'tenantId'); assertName(appId, 'appId'); assertName(key, 'key');
    const file = path.resolve(this.rootDir, tenantId, appId, `${key}.json`);
    if (!file.startsWith(`${this.rootDir}${path.sep}`)) throw new Error('state path escapes configured root');
    return file;
  }
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export default LocalStateStore;
