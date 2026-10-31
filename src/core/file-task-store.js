import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Synchronous, local-first task store.
 *
 * Each task is a separate JSON record. A write is staged in the same directory
 * and atomically renamed so a crash cannot leave a partially-written record.
 * This is a single-host store, not a distributed queue or multi-writer lease.
 */
export class FileTaskStore {
  constructor({ directory } = {}) {
    if (!directory || typeof directory !== 'string') {
      throw new TypeError('FileTaskStore requires a directory');
    }
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  _file(taskId) {
    if (typeof taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(taskId)) {
      throw new TypeError('Invalid task id');
    }
    return path.join(this.directory, `${taskId}.json`);
  }

  save(task) {
    if (!task?.taskId) throw new TypeError('A task with taskId is required');
    const target = this._file(task.taskId);
    const temporary = path.join(this.directory, `.${task.taskId}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(task), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return target;
  }

  appendEvent(taskId, event) {
    if (!event || event.taskId !== taskId || typeof event.eventId !== 'string' || typeof event.type !== 'string') {
      throw new TypeError('A task event with matching taskId, eventId, and type is required');
    }
    const file = this._file(taskId).replace(/\.json$/, '.events.jsonl');
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(event)}\n`, null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return file;
  }

  readEvents(taskId) {
    const file = this._file(taskId).replace(/\.json$/, '.events.jsonl');
    try {
      return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  get(taskId) {
    const file = this._file(taskId);
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  list({ status = null, scope = {} } = {}) {
    const entries = fs.readdirSync(this.directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^[a-zA-Z0-9_-]{1,128}\.json$/.test(entry.name))
      .map((entry) => JSON.parse(fs.readFileSync(path.join(this.directory, entry.name), 'utf8')))
      .filter((task) => (!status || task.status === status)
        && ['tenantId', 'domainId', 'siteId', 'userId'].every((key) => !scope[key] || task.scope?.[key] === scope[key]));
  }
}

export default FileTaskStore;
