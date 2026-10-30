const ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/;
const PERMISSION_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export function validateApplicationManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('manifest must be an object');
  const { id, version, entrypoint, runtime = 'portable', permissions = [], services = [] } = input;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new TypeError('manifest.id must be a lowercase package identifier');
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new TypeError('manifest.version must be semantic version X.Y.Z');
  if (typeof entrypoint !== 'string' || !entrypoint.trim() || entrypoint.startsWith('/') || entrypoint.split(/[\\/]/).includes('..')) throw new TypeError('manifest.entrypoint must be a relative path without traversal');
  if (typeof runtime !== 'string' || !ID_PATTERN.test(runtime)) throw new TypeError('manifest.runtime must be a valid runtime identifier');
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string' || !PERMISSION_PATTERN.test(p))) throw new TypeError('manifest.permissions must contain valid capability names');
  if (!Array.isArray(services) || services.some((s) => typeof s !== 'string' || !ID_PATTERN.test(s))) throw new TypeError('manifest.services must contain valid service identifiers');
  return Object.freeze({
    id, version, entrypoint, runtime,
    permissions: Object.freeze([...new Set(permissions)]),
    services: Object.freeze([...new Set(services)]),
  });
}
