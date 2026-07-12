/**
 * src/tools/index.js
 *
 * Domain-agnostic tool definitions for the AgentKernel / ToolRegistry.
 * Tools receive a `ctx` object with { client, params, userId, workspace }.
 * Domain-specific clients (MikroTik RouterOS, etc.) are accessed via ctx.client.
 *
 * Previous version used router.menu('/ping').call({...}) — updated to the
 * canonical RouterOS API pattern: client.menu('/path').call(params)
 */

const tools = {

  // ── Network tools ──────────────────────────────────────────────────────────
  'network.ping': async (ctx, host) => {
    const client = ctx.client || ctx;
    return client.menu('/ping').call({ address: host, count: '4' });
  },

  'network.resource': async (ctx) => {
    const client = ctx.client || ctx;
    return client.menu('/system/resource').get();
  },

  'network.interfaces': async (ctx) => {
    const client = ctx.client || ctx;
    return client.menu('/interface').get();
  },

  // ── Hotspot tools ──────────────────────────────────────────────────────────
  'hotspot.addUser': async (ctx, name, profile) => {
    const client = ctx.client || ctx;
    return client.menu('/ip/hotspot/user').add({ name, password: name, profile });
  },

  'hotspot.active': async (ctx) => {
    const client = ctx.client || ctx;
    return client.menu('/ip/hotspot/active').get();
  },

  'hotspot.profiles': async (ctx) => {
    const client = ctx.client || ctx;
    return client.menu('/ip/hotspot/profile').get();
  },

  // ── Voucher tools ──────────────────────────────────────────────────────────
  'voucher.generate': async (ctx, { count = 1, profile = 'default', validity = '1d' } = {}) => {
    const vouchers = [];
    for (let i = 0; i < count; i++) {
      vouchers.push({ code: Math.random().toString(36).substring(2, 10).toUpperCase(), profile, validity });
    }
    return { vouchers, count };
  },

};

export default tools;