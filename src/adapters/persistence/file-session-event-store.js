import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Append-only JSONL persistence adapter for SessionEventStore.
 * The core owns event semantics; this adapter owns filesystem durability.
 */
export class FileSessionEventStore {
  constructor({ rootDir = path.join(os.homedir(), '.br3eze-os', 'sessions') } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new TypeError('rootDir is required');
    this.rootDir = path.resolve(rootDir);
    this.queues = new Map();
  }

  #file(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 512 || /[\u0000-\u001f\u007f]/.test(sessionId)) {
      throw new TypeError('sessionId must be a non-empty safe string');
    }
    return path.join(this.rootDir, `${encodeURIComponent(sessionId)}.jsonl`);
  }

  async append(sessionId, event) {
    const file = this.#file(sessionId);
    const previous = this.queues.get(sessionId) || Promise.resolve();
    const current = previous.catch(() => {}).then(async () => {
      await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      const line = JSON.stringify(event);
      if (line === undefined) throw new TypeError('session event must be JSON-serializable');
      await fs.appendFile(file, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
      return { ...event };
    });
    this.queues.set(sessionId, current);
    try { return await current; }
    finally { if (this.queues.get(sessionId) === current) this.queues.delete(sessionId); }
  }

  async read(sessionId, { after = 0, limit = Infinity } = {}) {
    const file = this.#file(sessionId);
    if (!Number.isSafeInteger(after) || after < 0) throw new RangeError('after must be a non-negative safe integer');
    if (!(limit === Infinity || (Number.isSafeInteger(limit) && limit >= 0))) throw new RangeError('limit must be a non-negative safe integer');
    await this.queues.get(sessionId)?.catch(() => {});
    let content;
    try { content = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const events = content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return events.slice(after, after + limit).map((event) => JSON.parse(JSON.stringify(event)));
  }

  async getLast(sessionId) {
    const events = await this.read(sessionId);
    return events.at(-1) || null;
  }

  async list() {
    let files;
    try { files = await fs.readdir(this.rootDir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return files.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => {
        try { return decodeURIComponent(entry.name.slice(0, -6)); }
        catch { return null; }
      }).filter(Boolean).sort();
  }

  async close() {
    await Promise.allSettled([...this.queues.values()]);
  }
}

export default FileSessionEventStore;
