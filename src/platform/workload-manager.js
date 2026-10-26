import { validateApplicationManifest } from './application-manifest.js';

/**
 * Managed workload lifecycle over an injected execution adapter. The manager
 * never evals source or dynamically imports an entrypoint; adapters own the
 * execution strategy and must provide real isolation for untrusted workloads.
 */
export class WorkloadManager {
  #runners = new Map();
  #workloads = new Map();
  #permissions;

  constructor({ permissions } = {}) {
    if (!permissions || typeof permissions.assert !== 'function') throw new TypeError('permissions policy is required');
    this.#permissions = permissions;
  }

  registerRunner(runtime, runner) {
    if (typeof runtime !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/.test(runtime)) throw new TypeError('runtime identifier is invalid');
    if (!runner || typeof runner.start !== 'function' || typeof runner.stop !== 'function') throw new TypeError('runner must implement start(workload, context) and stop(handle, context)');
    if (this.#runners.has(runtime)) throw new Error(`Runner already registered: ${runtime}`);
    this.#runners.set(runtime, runner);
  }

  install(input) {
    const manifest = validateApplicationManifest(input);
    if (this.#workloads.has(manifest.id)) throw new Error(`Workload already installed: ${manifest.id}`);
    if (!this.#runners.has(manifest.runtime)) {
      const error = new Error(`No runner registered for runtime: ${manifest.runtime}`);
      error.code = 'WORKLOAD_RUNTIME_NOT_FOUND';
      throw error;
    }
    this.#workloads.set(manifest.id, { manifest, state: 'installed', handle: null, error: null });
    return this.status(manifest.id);
  }

  async start(id, context = {}) {
    const workload = this.#require(id);
    if (workload.state === 'running') return this.status(id);
    if (workload.state === 'starting' || workload.state === 'stopping') throw new Error(`Invalid workload lifecycle transition: ${workload.state}`);
    for (const capability of workload.manifest.permissions) this.#permissions.assert(id, capability);
    workload.state = 'starting'; workload.error = null;
    try {
      const runner = this.#runners.get(workload.manifest.runtime);
      workload.handle = await runner.start(workload.manifest, Object.freeze({ ...context, workloadId: id, capabilities: [...workload.manifest.permissions] }));
      workload.state = 'running';
      return this.status(id);
    } catch (error) {
      workload.state = 'failed'; workload.error = String(error?.message || error);
      throw error;
    }
  }

  async stop(id, context = {}) {
    const workload = this.#require(id);
    if (workload.state === 'stopped' || workload.state === 'installed') {
      workload.state = 'stopped';
      return this.status(id);
    }
    if (workload.state !== 'running' && workload.state !== 'failed') throw new Error(`Invalid workload lifecycle transition: ${workload.state}`);
    workload.state = 'stopping';
    try {
      await this.#runners.get(workload.manifest.runtime).stop(workload.handle, Object.freeze({ ...context, workloadId: id }));
      workload.handle = null; workload.state = 'stopped'; workload.error = null;
      return this.status(id);
    } catch (error) {
      workload.state = 'failed'; workload.error = String(error?.message || error);
      throw error;
    }
  }

  status(id) {
    const item = this.#workloads.get(id);
    if (!item) return null;
    return Object.freeze({ id, version: item.manifest.version, runtime: item.manifest.runtime, state: item.state, error: item.error });
  }

  list() { return [...this.#workloads.keys()].map((id) => this.status(id)); }

  #require(id) {
    const item = this.#workloads.get(id);
    if (!item) throw new Error(`Unknown workload: ${id}`);
    return item;
  }
}
