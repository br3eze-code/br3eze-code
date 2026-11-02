const APP_ID = /^[a-z][a-z0-9._-]{0,95}$/i;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new TypeError('application manifest must be an object');
  if (typeof manifest.id !== 'string' || !APP_ID.test(manifest.id)) throw new TypeError('manifest.id must be a stable identifier');
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) throw new TypeError('manifest.version must be semantic version x.y.z');
  if (typeof manifest.entryService !== 'string' || !APP_ID.test(manifest.entryService)) throw new TypeError('manifest.entryService must be a service identifier');
  const permissions = manifest.permissions || [];
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string' || !/^[a-z][a-z0-9._:-]{0,127}$/i.test(p))) throw new TypeError('manifest.permissions must be stable permission identifiers');
  return Object.freeze({
    id: manifest.id,
    version: manifest.version,
    name: typeof manifest.name === 'string' ? manifest.name : manifest.id,
    entryService: manifest.entryService,
    permissions: Object.freeze([...new Set(permissions)]),
    description: typeof manifest.description === 'string' ? manifest.description : '',
  });
}

/**
 * Registers declarative app manifests and delegates execution lifecycle to the
 * trusted ServiceSupervisor. This does not execute package code or create a sandbox.
 */
export class ApplicationManager {
  constructor({ supervisor } = {}) {
    if (!supervisor || typeof supervisor.register !== 'function' || typeof supervisor.start !== 'function' || typeof supervisor.stop !== 'function') {
      throw new TypeError('ApplicationManager requires a ServiceSupervisor');
    }
    this.supervisor = supervisor;
    this.apps = new Map();
  }

  register(manifest, service) {
    const normalized = validateManifest(manifest);
    if (this.apps.has(normalized.id)) throw new Error(`application already registered: ${normalized.id}`);
    if (!service || service.id !== normalized.entryService) throw new Error('application service must match manifest.entryService');
    this.supervisor.register(service);
    this.apps.set(normalized.id, { manifest: normalized, state: 'installed', installedAt: new Date().toISOString() });
    return this.describe(normalized.id);
  }

  async start(appId, context = {}) {
    const app = this.#require(appId);
    try {
      const result = await this.supervisor.start(app.manifest.entryService, {
        ...context,
        application: { id: app.manifest.id, version: app.manifest.version, permissions: [...app.manifest.permissions] },
      });
      app.state = result.state === 'running' ? 'running' : result.state;
      return this.describe(appId);
    } catch (error) {
      app.state = 'failed';
      throw error;
    }
  }

  async stop(appId, context = {}) {
    const app = this.#require(appId);
    try {
      const result = await this.supervisor.stop(app.manifest.entryService, context);
      app.state = result.state === 'stopped' ? 'stopped' : result.state;
      return this.describe(appId);
    } catch (error) {
      app.state = 'failed';
      throw error;
    }
  }

  describe(appId) {
    const app = this.#require(appId);
    return { ...app.manifest, state: app.state, installedAt: app.installedAt };
  }

  list() { return [...this.apps.keys()].map((id) => this.describe(id)); }

  #require(id) {
    const app = this.apps.get(id);
    if (!app) throw new Error(`application not found: ${id}`);
    return app;
  }
}

export default ApplicationManager;
