import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class PluginManager {
  constructor(agent, { logger = agent?.logger || console } = {}) {
    this.agent = agent;
    this.logger = logger;
    this.plugins = new Map();
    this.hooks = new Map(['preInitialize', 'postInitialize', 'preSkillExecute', 'postSkillExecute', 'preShutdown'].map(name => [name, []]));
  }

  async load(pluginPath, options = {}) {
    const absolutePath = path.resolve(pluginPath);
    const module = await import(pathToFileURL(absolutePath).href);
    const Exported = module.default ?? module.Plugin ?? module;
    const instance = typeof Exported === 'function' ? new Exported(this.agent, options) : Exported;
    if (!instance || typeof instance !== 'object') throw new TypeError(`Plugin '${pluginPath}' did not export a plugin object or class`);
    for (const [event, handler] of Object.entries(instance.hooks || {})) {
      if (typeof handler === 'function' && this.hooks.has(event)) this.hooks.get(event).push({ name: instance.name || pluginPath, handler: handler.bind(instance) });
    }
    await instance.initialize?.();
    const name = instance.name || pluginPath;
    this.plugins.set(name, instance);
    return instance;
  }

  async loadBuiltinCustom(agent = this.agent, options = {}) {
    const { GraphEngineeringPlugin, WorkflowOrchestrationPlugin } = await import('./custom/index.js');
    const graph = await this.loadClass(GraphEngineeringPlugin, agent, options.graph || {});
    const workflows = await this.loadClass(WorkflowOrchestrationPlugin, agent, options.workflows || {});
    return { graph, workflows };
  }

  async loadClass(PluginClass, agent = this.agent, options = {}) {
    const instance = new PluginClass(agent, options);
    await instance.initialize?.();
    this.plugins.set(instance.name, instance);
    return instance;
  }

  async executeHook(event, ...args) {
    for (const entry of this.hooks.get(event) || []) {
      try { await entry.handler(...args); }
      catch (error) {
        this.logger.error?.(`Plugin hook ${event} failed in ${entry.name}: ${error.message}`);
        if (event === 'preInitialize' || event === 'preShutdown') throw error;
      }
    }
  }

  get(name) { return this.plugins.get(name) || null; }
  list() { return [...this.plugins.keys()]; }

  async unload(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    await plugin.destroy?.();
    for (const handlers of this.hooks.values()) {
      for (let i = handlers.length - 1; i >= 0; i -= 1) if (handlers[i].name === name) handlers.splice(i, 1);
    }
    this.plugins.delete(name);
    return true;
  }

  async shutdown() { await Promise.allSettled([...this.plugins.keys()].map(name => this.unload(name))); }
}

export class AnalyticsPlugin {
  constructor(agent) { this.name = 'analytics'; this.agent = agent; this.hooks = { postSkillExecute: this.trackSkillUsage }; }
  async trackSkillUsage(result, context) { await this.agent.telemetry?.record?.('skill_executed', { skill: result?.skill, userId: context?.userId, duration: result?.duration, success: !result?.error }); }
}

export default PluginManager;
