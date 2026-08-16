import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAINS_DIR = path.join(__dirname, '../domains');

function humanize(value) {
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function domainIdFromEntry(entry) {
  return String(entry).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

/**
 * Return the domains available to the current AgentOS installation.
 * Filesystem discovery is intentionally passive: it does not import domain
 * modules or execute provider code while a channel is building its menu.
 */
export function listAvailableDomains(config = {}) {
  const discovered = new Map();
  if (fs.existsSync(DOMAINS_DIR)) {
    for (const entry of fs.readdirSync(DOMAINS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const id = domainIdFromEntry(entry.name);
      discovered.set(id, {
        id,
        name: humanize(entry.name),
        description: `Use ${humanize(entry.name)} tools and workflows`,
        configured: Boolean(config[entry.name] || config[id]),
      });
    }
  }

  for (const [key, value] of Object.entries(config || {})) {
    if (key.startsWith('_')) continue;
    const id = domainIdFromEntry(key);
    const existing = discovered.get(id) || { id, name: humanize(key), configured: false };
    discovered.set(id, {
      ...existing,
      name: value?.name || existing.name,
      description: value?.description || existing.description || `Use ${existing.name} tools and workflows`,
      configured: true,
    });
  }

  return [...discovered.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildStartMenu({ config = {}, includeLegacyActions = true } = {}) {
  const domains = listAvailableDomains(config);
  const actions = includeLegacyActions
    ? [
      { id: 'process:status', label: 'System', icon: '⚙️' },
      { id: 'process:shop', label: 'Shop', icon: '🛍️' },
      { id: 'process:ask', label: 'Ask', icon: '💬' },
      { id: 'process:help', label: 'Help', icon: '❓' },
    ]
    : [];
  return { domains, actions };
}

export function formatStartText({ brand = 'AgentOS', username = 'there', config = {} } = {}) {
  const { domains, actions } = buildStartMenu({ config });
  const lines = [`🤖 *${brand}*`, `Welcome, ${username}. Choose a domain or action:`];
  if (domains.length) {
    lines.push('', '*Domains*');
    for (const domain of domains) lines.push(`• ${domain.name} — ${domain.description}`);
  }
  if (actions.length) {
    lines.push('', '*Actions*');
    for (const action of actions) lines.push(`• ${action.icon} ${action.label}`);
  }
  return lines.join('\n');
}

export function telegramStartKeyboard({ config = {} } = {}) {
  const { domains, actions } = buildStartMenu({ config });
  const rows = [];
  for (let index = 0; index < domains.length; index += 2) {
    rows.push(domains.slice(index, index + 2).map((domain) => ({
      text: `🧩 ${domain.name}`,
      callback_data: `domain:${domain.id}`,
    })));
  }
  for (let index = 0; index < actions.length; index += 2) {
    rows.push(actions.slice(index, index + 2).map((action) => ({
      text: `${action.icon} ${action.label}`,
      callback_data: action.id,
    })));
  }
  return { inline_keyboard: rows };
}

export default { listAvailableDomains, buildStartMenu, formatStartText, telegramStartKeyboard };

