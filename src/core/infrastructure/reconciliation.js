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
