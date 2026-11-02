const SECRET_KEY = /(?:secret|token|password|private.?key|api.?key|credential)/i;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function resourceKey(resource) {
  return [resource.provider, resource.kind, resource.id].join(':');
}

function validateInventory(resources, label) {
  if (!Array.isArray(resources)) throw new TypeError(`${label} inventory must be an array`);
  const seen = new Set();
  for (const resource of resources) {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new TypeError(`Invalid ${label} resource`);
    for (const field of ['provider', 'kind', 'id']) {
      if (typeof resource[field] !== 'string' || !resource[field].trim()) throw new TypeError(`${label} resource requires ${field}`);
    }
    const key = resourceKey(resource);
    if (seen.has(key)) throw new TypeError(`Duplicate ${label} resource: ${key}`);
    seen.add(key);
    for (const name of Object.keys(resource.attributes || {})) if (SECRET_KEY.test(name)) throw new TypeError(`Secret-like attribute names are not allowed in inventory: ${name}`);
  }
}

export function planReconciliation({ desired, observed }) {
  validateInventory(desired, 'desired');
  validateInventory(observed, 'observed');
  const remote = new Map(observed.map((item) => [resourceKey(item), item]));
  const actions = [];
  for (const target of desired) {
    const key = resourceKey(target);
    const current = remote.get(key);
    if (!current) {
      actions.push({ action: 'create', key, provider: target.provider, kind: target.kind, id: target.id, desired: stable(target.attributes || {}) });
      continue;
    }
    if (JSON.stringify(stable(current.attributes || {})) !== JSON.stringify(stable(target.attributes || {}))) {
      actions.push({ action: 'update', key, provider: target.provider, kind: target.kind, id: target.id, observed: stable(current.attributes || {}), desired: stable(target.attributes || {}), requiresApproval: true });
    } else actions.push({ action: 'in_sync', key, provider: target.provider, kind: target.kind, id: target.id });
    remote.delete(key);
  }
  for (const current of remote.values()) actions.push({ action: 'orphan_preserved', key: resourceKey(current), provider: current.provider, kind: current.kind, id: current.id, destructive: false });
  const counts = actions.reduce((result, item) => { result[item.action] = (result[item.action] || 0) + 1; return result; }, {});
  return Object.freeze({ mode: 'plan-only', destructiveChangesApplied: 0, counts, actions });
}

export function compareMigrationHistory({ local, remote }) {
  const validate = (items, label) => {
    if (!Array.isArray(items)) throw new TypeError(label + ' migrations must be an array');
    const seen = new Set();
    for (const item of items) {
      if (!item || !/^\d{14}$/.test(item.version) || typeof item.name !== 'string' || !item.name.trim()) throw new TypeError('Invalid ' + label + ' migration');
      if (seen.has(item.version)) throw new TypeError('Duplicate ' + label + ' migration version: ' + item.version);
      seen.add(item.version);
    }
  };
  validate(local, 'local');
  validate(remote, 'remote');
  const remoteByVersion = new Map(remote.map((item) => [item.version, item]));
  const localByVersion = new Map(local.map((item) => [item.version, item]));
  const remoteByName = new Map();
  const localByName = new Map();
  for (const item of remote) remoteByName.set(item.name, [...(remoteByName.get(item.name) || []), item]);
  for (const item of local) localByName.set(item.name, [...(localByName.get(item.name) || []), item]);
  const exact = [];
  const versionMismatch = [];
  const localOnly = [];
  const remoteOnly = [];
  for (const item of local) {
    const sameVersion = remoteByVersion.get(item.version);
    if (sameVersion) {
      if (sameVersion.name === item.name) exact.push({ version: item.version, name: item.name });
      else versionMismatch.push({ name: item.name, localVersion: item.version, remoteVersion: sameVersion.version, remoteName: sameVersion.name, reason: 'same_version_different_name' });
      continue;
    }
    const sameName = remoteByName.get(item.name) || [];
    if (sameName.length) versionMismatch.push({ name: item.name, localVersion: item.version, remoteVersions: sameName.map((entry) => entry.version), reason: 'same_name_different_version' });
    else localOnly.push(item);
  }
  for (const item of remote) {
    if (localByVersion.has(item.version)) continue;
    if (!(localByName.get(item.name) || []).length) remoteOnly.push(item);
  }
  return { localCount: local.length, remoteCount: remote.length, exactMatches: exact, versionMismatches: versionMismatch, localOnly, remoteOnly, safeToAutoApply: false };
}
