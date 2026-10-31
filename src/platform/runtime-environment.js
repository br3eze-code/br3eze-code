import { ProviderRegistry } from './provider-registry.js';
import { ServiceSupervisor } from './service-supervisor.js';
import { PermissionPolicy } from './permission-policy.js';
import { IpcBus } from './ipc-bus.js';

/**
 * Host-neutral platform container, analogous in intent (not implementation)
 * to a managed VM environment. It wires platform services and SPIs but does
 * not create a second agent loop or execute arbitrary package entrypoints.
 */
export class RuntimeEnvironment {
  constructor({ ipcTopics = [], maxIpcPayloadBytes = 64 * 1024, permissions = new PermissionPolicy(), providers = new ProviderRegistry(), supervisor = new ServiceSupervisor() } = {}) {
    this.permissions = permissions;
    this.providers = providers;
    this.supervisor = supervisor;
    this.ipc = new IpcBus({ topics: ipcTopics, maxPayloadBytes: maxIpcPayloadBytes });
    this.state = 'created';
  }

  registerProvider(provider) {
    if (this.state === 'stopping' || this.state === 'stopped') throw new Error('Runtime environment is shutting down');
    return this.providers.register(provider);
  }

  resolveProvider(query) {
    const provider = this.providers.resolve(query);
    if (!provider) {
      const error = new Error(`No provider matches ${JSON.stringify(query)}`);
      error.code = 'PROVIDER_NOT_FOUND';
      throw error;
    }
    return provider;
  }

  async start(context = {}) {
    if (this.state === 'running') return this.status();
    if (this.state === 'stopping' || this.state === 'stopped') throw new Error('Runtime environment cannot be restarted after shutdown');
    this.state = 'starting';
    this.emitState();
    this.state = 'running';
    this.emitState();
    return this.status();
  }

  async stop(context = {}) {
    if (this.state === 'stopped') return this.status();
    this.state = 'stopping';
    this.emitState();
    const services = await this.supervisor.stopAll(context);
    this.state = 'stopped';
    this.emitState();
    return { ...this.status(), services };
  }

  status() {
    return Object.freeze({ state: this.state, providers: this.providers.list(), services: this.supervisor.list() });
  }

  emitState() {
    // A host can observe lifecycle via status() or attach a supervisor listener.
    // No global process hooks are installed by importing this module.
  }
}
