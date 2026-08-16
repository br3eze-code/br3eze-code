import fs from 'node:fs/promises';
import path from 'node:path';

const URI_ACTIONS = new Set(['open', 'new', 'daily', 'unique', 'search', 'choose-vault']);
const MUTATING_ACTIONS = new Set(['new', 'daily', 'unique']);
const MAX_CONTEXT_CHARS = 12000;

function assertText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`);
  if (value.includes('\0')) throw new TypeError(`${name} contains a null byte`);
  return value.trim();
}

export function normalizeVaultPath(input) {
  const value = assertText(input, 'vault path').replaceAll('\\', '/');
  if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) throw new Error('vault path must be relative');
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('vault path escapes vault root');
  return normalized.replace(/^\.\//, '');
}

export function createObsidianUri(action, params = {}) {
  if (!URI_ACTIONS.has(action)) throw new Error(`unsupported Obsidian URI action: ${action}`);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return `obsidian://${action}${suffix ? `?${suffix}` : ''}`;
}

function extractGraph(markdown) {
  const links = new Set();
  const tags = new Set();
  const wikilinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  const tagPattern = /(^|\s)#([A-Za-z0-9_/-]+)/g;
  for (const match of markdown.matchAll(wikilinkPattern)) links.add(match[1].trim());
  for (const match of markdown.matchAll(tagPattern)) tags.add(`#${match[2]}`);
  return { links: [...links].sort(), tags: [...tags].sort() };
}

function hasApproval(context) {
  return context?.approval?.approved === true || context?.approval?.status === 'approved';
}

function assertIdentity(context, mutation = false) {
  if (!context?.userId) throw new Error('authenticated identity required');
  if (mutation && !hasApproval(context)) throw new Error('approved context required for Obsidian mutation');
}

export class ObsidianVaultAdapter {
  constructor({ vaultRoot, audit = async () => {}, uriOpener = null, fileSystem = fs } = {}) {
    if (!vaultRoot) throw new TypeError('vaultRoot is required');
    this.vaultRoot = path.resolve(vaultRoot);
    this.audit = audit;
    this.uriOpener = uriOpener;
    this.fileSystem = fileSystem;
  }

  resolve(relativePath) {
    const safe = normalizeVaultPath(relativePath);
    const target = path.resolve(this.vaultRoot, safe);
    if (target !== this.vaultRoot && !target.startsWith(`${this.vaultRoot}${path.sep}`)) {
      throw new Error('vault path escapes vault root');
    }
    return { safe, target };
  }

  async isAvailable() {
    try { await this.fileSystem.access(this.vaultRoot); return true; } catch { return false; }
  }

  async readNote(relativePath, context = {}) {
    assertIdentity(context);
    const { safe, target } = this.resolve(relativePath);
    const content = await this.fileSystem.readFile(target, 'utf8');
    await this.audit({ action: 'obsidian.read', path: safe, ...scopeFields(context) });
    return { path: safe, content };
  }

  async writeNote(relativePath, content, context = {}) {
    assertIdentity(context, true);
    if (typeof content !== 'string') throw new TypeError('note content must be a string');
    const { safe, target } = this.resolve(relativePath);
    await this.fileSystem.mkdir(path.dirname(target), { recursive: true });
    await this.fileSystem.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
    await this.audit({ action: 'obsidian.write', path: safe, ...scopeFields(context) });
    return { path: safe, bytes: Buffer.byteLength(content) };
  }

  async graphContext(relativePath, context = {}, { maxChars = MAX_CONTEXT_CHARS } = {}) {
    const note = await this.readNote(relativePath, context);
    const graph = extractGraph(note.content.slice(0, Math.max(0, maxChars)));
    return { path: note.path, ...graph, truncated: note.content.length > maxChars };
  }

  async open(relativePath, context = {}, { vault } = {}) {
    assertIdentity(context);
    const { safe } = this.resolve(relativePath);
    const uri = createObsidianUri('open', { vault, file: safe });
    if (this.uriOpener) await this.uriOpener(uri);
    await this.audit({ action: 'obsidian.open', path: safe, ...scopeFields(context) });
    return { uri, path: safe };
  }

  async create(relativePath, content = '', context = {}, { vault, overwrite = false } = {}) {
    assertIdentity(context, true);
    const result = await this.writeNote(relativePath, content, context);
    const uri = createObsidianUri('new', { vault, file: result.path, content, overwrite });
    if (this.uriOpener) await this.uriOpener(uri);
    return { ...result, uri };
  }
}

function scopeFields(context) {
  return {
    userId: context.userId,
    tenantId: context.scope?.tenantId ?? context.tenantId ?? null,
    domain: context.scope?.domain ?? context.domain ?? null,
    siteId: context.scope?.siteId ?? context.siteId ?? null
  };
}

export { extractGraph };
