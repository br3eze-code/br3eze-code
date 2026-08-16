import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BaseSkill } from '../base.js';

class WorkspaceSkill extends BaseSkill {
  static id = 'workspace';
  static name = 'Workspace Files';
  static description = 'Safe typed file operations for the AgentOS workspace';

  constructor(config = {}, logger, workspace) {
    super(config, logger, workspace);
    const workspaceRoot = typeof workspace === 'string'
      ? workspace
      : workspace?.root || workspace?.path || config.workspace?.root || config.workspace?.path || process.cwd();
    this.workspace = path.resolve(workspaceRoot);
    this.undoRoot = path.join(this.workspace, '.agentos', 'undo');
  }

  static getTools() {
    return {
      'workspace.files': {
        risk: 'low',
        description: 'Inspect workspace files and directories without changing them.',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['list', 'read', 'diff'] },
            path: { type: 'string', description: 'Workspace-relative file or directory path' },
            range: { type: 'array', items: { type: 'integer' }, description: 'Optional 1-based line range [start,end]' }
          },
          required: ['operation']
        }
      },
      'workspace.edit': {
        risk: 'high',
        description: 'Create, replace, patch, rename, delete, or undo workspace files. Mutations require approval.',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['write', 'patch', 'rename', 'delete', 'undo'] },
            path: { type: 'string', description: 'Workspace-relative source path' },
            destination: { type: 'string', description: 'Workspace-relative destination for rename' },
            content: { type: 'string', description: 'Complete replacement content for write' },
            edits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  find: { type: 'string' },
                  replace: { type: 'string' },
                  all: { type: 'boolean' }
                },
                required: ['find', 'replace']
              }
            },
            undoId: { type: 'string', description: 'Undo record identifier' }
          },
          required: ['operation']
        }
      }
    };
  }

  async init() {
    await fs.mkdir(this.workspace, { recursive: true });
  }

  async execute(toolName, args = {}, ctx = {}) {
    if (toolName === 'files' || toolName === 'workspace.files') return this.inspect(args);
    if (toolName === 'edit' || toolName === 'workspace.edit') return this.edit(args, ctx);
    throw new Error(`Unknown workspace tool ${toolName}`);
  }

  async inspect({ operation = 'list', path: relativePath = '.', range } = {}) {
    const target = await this._safePath(relativePath);
    if (operation === 'list') return this._list(target, relativePath);
    if (operation === 'read') return this._read(target, relativePath, range);
    if (operation === 'diff') return this._diff(target, relativePath);
    throw new Error(`Unsupported workspace inspection operation: ${operation}`);
  }

  async edit({ operation, path: relativePath = '.', destination, content, edits = [], undoId } = {}, ctx = {}) {
    if (!['write', 'patch', 'rename', 'delete', 'undo'].includes(operation)) {
      throw new Error(`Unsupported workspace edit operation: ${operation}`);
    }
    if (!this._approved(ctx)) {
      return {
        approvalRequired: true,
        operation,
        path: relativePath,
        destination: destination || null,
        message: 'This workspace mutation requires explicit approval.'
      };
    }

    if (operation === 'undo') return this._undo(undoId);
    const target = await this._safePath(relativePath, { allowMissing: operation !== 'delete' });
    const snapshot = await this._snapshot(target, relativePath);

    if (operation === 'write') {
      if (typeof content !== 'string') throw new TypeError('content is required for write');
      await this._atomicWrite(target, content);
    } else if (operation === 'patch') {
      const current = await fs.readFile(target, 'utf8');
      const updated = this._applyEdits(current, edits);
      await this._atomicWrite(target, updated);
    } else if (operation === 'rename') {
      if (!destination) throw new TypeError('destination is required for rename');
      const dest = await this._safePath(destination, { allowMissing: true });
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(target, dest);
    } else if (operation === 'delete') {
      await fs.rm(target, { recursive: false, force: false });
    }

    return {
      operation,
      path: relativePath,
      destination: destination || null,
      changed: true,
      undoId: snapshot.id,
      approvedBy: ctx.approvedBy || ctx.userId || ctx._uid || 'approval'
    };
  }

  async _list(target, relativePath) {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) return { operation: 'list', path: relativePath, entries: [this._entry(relativePath, stat)] };
    const names = await fs.readdir(target, { withFileTypes: true });
    return {
      operation: 'list',
      path: relativePath,
      entries: names.sort((a, b) => a.name.localeCompare(b.name)).map(entry => ({
        name: entry.name,
        path: path.relative(this.workspace, path.join(target, entry.name)),
        type: entry.isDirectory() ? 'directory' : 'file'
      }))
    };
  }

  async _read(target, relativePath, range) {
    const text = await fs.readFile(target, 'utf8');
    const lines = text.split(/\r?\n/);
    const [start, end] = Array.isArray(range) ? range : [1, lines.length];
    const from = Math.max(1, Number(start) || 1);
    const to = Math.min(lines.length, Number(end) || lines.length);
    return { operation: 'read', path: relativePath, start: from, end: to, content: lines.slice(from - 1, to).join('\n') };
  }

  async _diff(target, relativePath) {
    const current = await fs.readFile(target, 'utf8');
    const hash = crypto.createHash('sha256').update(current).digest('hex');
    return { operation: 'diff', path: relativePath, hash, lines: current.split(/\r?\n/).length, changed: false };
  }

  async _atomicWrite(target, content) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.agentos-${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, content, 'utf8');
      await fs.rename(temp, target);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  }

  _applyEdits(content, edits) {
    if (!Array.isArray(edits) || edits.length === 0) throw new TypeError('edits must contain at least one edit');
    return edits.reduce((result, edit) => {
      if (!edit || typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
        throw new TypeError('each edit requires string find and replace values');
      }
      if (!result.includes(edit.find)) throw new Error(`Edit target not found: ${edit.find.slice(0, 80)}`);
      return edit.all ? result.split(edit.find).join(edit.replace) : result.replace(edit.find, edit.replace);
    }, content);
  }

  async _snapshot(target, relativePath) {
    await fs.mkdir(this.undoRoot, { recursive: true });
    const id = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const record = { id, path: relativePath, existed: false, backup: null };
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) throw new Error('Directory mutation is not supported');
      record.existed = true;
      record.backup = path.join(this.undoRoot, `${id}.bak`);
      await fs.copyFile(target, record.backup);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      record.existed = false;
    }
    await fs.writeFile(path.join(this.undoRoot, `${id}.json`), JSON.stringify(record), 'utf8');
    return record;
  }

  async _undo(undoId) {
    if (!undoId) throw new TypeError('undoId is required');
    const record = JSON.parse(await fs.readFile(path.join(this.undoRoot, `${undoId}.json`), 'utf8'));
    const target = await this._safePath(record.path, { allowMissing: true });
    if (record.existed) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(record.backup, target);
    } else {
      await fs.rm(target, { force: true });
    }
    return { operation: 'undo', path: record.path, restored: true, undoId };
  }

  async _safePath(relativePath, { allowMissing = false } = {}) {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error('Workspace paths must be relative');
    const target = path.resolve(this.workspace, relativePath);
    if (target !== this.workspace && !target.startsWith(`${this.workspace}${path.sep}`)) throw new Error('Path escapes workspace');
    if (!allowMissing) {
      const realWorkspace = await fs.realpath(this.workspace);
      const realTarget = await fs.realpath(target);
      if (realTarget !== realWorkspace && !realTarget.startsWith(`${realWorkspace}${path.sep}`)) throw new Error('Symlink escapes workspace');
    }
    return target;
  }

  _approved(ctx) {
    return ctx.approved === true || ctx.approval?.approved === true || ctx.approvalStatus === 'approved';
  }

  _entry(relativePath, stat) {
    return { name: path.basename(relativePath), path: relativePath, type: stat.isDirectory() ? 'directory' : 'file' };
  }
}

export default WorkspaceSkill;
