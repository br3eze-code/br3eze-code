import path from 'node:path';
import { pathToFileURL } from 'node:url';

class PluginManager {
  constructor(agent, options = {}) {
    this.agent = agent;
    this.plugins = new Map();
    this.logger = options.logger || agent?.logger || console;
    this.hooks = {
      preInitialize: [],
      postInitialize: [],
      preSkillExecute: [],
      postSkillExecute: [],
      preShutdown: []
    };
  }

  async load(pluginPath, options = {}) {
    const absolutePath = path.resolve(pluginPath);
    const module = await import(pathToFileURL(absolutePath).href);
    const Exported = module.default ?? module.Plugin ?? module;
    const instance = typeof Exported === 'function' ? new Exported(this.agent, options) : Exported;
    if (!instance || typeof instance !== 'object') throw new TypeError(`Plugin '${pluginPath}' did not export a plugin object or class`);

    if (instance.hooks) {
      for (const [event, handler] of Object.entries(instance.hooks)) {
        if (!this.hooks[event] || typeof handler !== 'function') continue;
        this.hooks[event].push({ name: instance.name || pluginPath, handler: handler.bind(instance) });
      }
    }

    await instance.initialize?.();
    const name = instance.name || pluginPath;
    this.plugins.set(name, instance);
    return instance;
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
    await plugin.destroy?.();
    for (const handlers of Object.values(this.hooks)) {
      for (let i = handlers.length - 1; i >= 0; i -= 1) if (handlers[i].name === name) handlers.splice(i, 1);
    }
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
    await this.agent.telemetry?.record?.('skill_executed', {
      skill: result?.skill,
      userId: context?.userId,
      duration: result?.duration,
      success: !result?.error
    });
  }
}

export { PluginManager, AnalyticsPlugin };
