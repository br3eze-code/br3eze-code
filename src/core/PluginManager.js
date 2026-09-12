import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describeCapability, checkCapabilityBoundary } from './capability-boundary.js';

class PluginManager {
  constructor(agent, options = {}) {
    this.agent = agent;
    this.plugins = new Map();
    this.capabilities = new Map();
    this.logger = options.logger || agent?.logger || console;
    this.hooks = { preInitialize: [], postInitialize: [], preSkillExecute: [], postSkillExecute: [], preShutdown: [] };
  }

  async load(pluginPath, options = {}) {
    const absolutePath = path.resolve(pluginPath);
    const module = await import(pathToFileURL(absolutePath).href);
    const Exported = module.default ?? module.Plugin ?? module;
    const instance = typeof Exported === 'function' ? new Exported(this.agent, options) : Exported;
    if (!instance || typeof instance !== 'object') throw new TypeError(`Plugin '${pluginPath}' did not export a plugin object or class`);

    const name = String(instance.name || pluginPath);
    const capabilities = instance.capabilities || instance.capabilityManifest || [];
    for (const capability of Array.isArray(capabilities) ? capabilities : Object.values(capabilities)) this.registerCapability(capability, name);

    if (instance.hooks) {
      for (const [event, handler] of Object.entries(instance.hooks)) {
        if (!this.hooks[event] || typeof handler !== 'function') continue;
        this.hooks[event].push({ name, handler: handler.bind(instance) });
      }
    }

    await this.executeHook('preInitialize', { plugin: name, instance });
    await instance.initialize?.();
    await this.executeHook('postInitialize', { plugin: name, instance });
    this.plugins.set(name, instance);
    return instance;
  }

  registerCapability(capability, pluginName = 'unknown') {
    const descriptor = describeCapability(capability);
    if (this.capabilities.has(descriptor.id)) throw new Error(`Capability already registered: ${descriptor.id}`);
    this.capabilities.set(descriptor.id, Object.freeze({ ...descriptor, plugin: pluginName }));
    return this.capabilities.get(descriptor.id);
  }

  getCapabilities({ domain = null, phase = null } = {}) {
    return [...this.capabilities.values()].filter((capability) => (!domain || capability.domain === domain) && (!phase || capability.phase === phase));
  }

  inspectCapability(id, context = {}, options = {}) {
    const capability = this.capabilities.get(id);
    if (!capability) return { allowed: false, errors: ['capability_not_found'] };
    return { capability, ...checkCapabilityBoundary(capability, context, options) };
  }

  async executeHook(event, ...args) {
    for (const entry of this.hooks[event] || []) {
      try {
        await entry.handler(...args);
      } catch (error) {
        this.logger.error?.(`Plugin hook ${event} failed in ${entry.name}: ${error.message}`);
        if (event === 'preInitialize' || event === 'preShutdown') throw error;
      }
    }
  }

  async unload(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    await this.executeHook('preShutdown', { plugin: name, instance: plugin });
    await plugin.destroy?.();
    for (const handlers of Object.values(this.hooks)) for (let i = handlers.length - 1; i >= 0; i -= 1) if (handlers[i].name === name) handlers.splice(i, 1);
    for (const [id, capability] of this.capabilities) if (capability.plugin === name) this.capabilities.delete(id);
    this.plugins.delete(name);
    return true;
  }
}

class AnalyticsPlugin {
  constructor(agent) {
    this.name = 'analytics';
    this.agent = agent;
    this.hooks = { postSkillExecute: this.trackSkillUsage };
  }

  async trackSkillUsage(result, context) {
    await this.agent.telemetry?.record?.('skill_executed', { skill: result?.skill, userId: context?.userId, duration: result?.duration, success: !result?.error });
  }
}

export { PluginManager, AnalyticsPlugin };
