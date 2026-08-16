import { getManager } from '../../core/mikrotik.js';

const READ_TOOLS = new Set([
  'network.capabilities',
  'network.health',
  'network.system.identity',
  'network.system.resources',
  'network.interface.list',
  'network.ip.addresses',
  'network.ip.routes',
  'network.arp.table',
  'network.dhcp.leases',
  'network.firewall.summary',
  'network.firewall.list',
  'network.diagnostics.ping',
  'network.diagnostics.traceroute',
]);

const WRITE_TOOLS = new Set(['network.firewall.block', 'network.firewall.unblock']);
const TOOL_MAP = {
  'network.health': 'system.health',
  'network.system.identity': 'system.identity',
  'network.system.resources': 'system.resources',
  'network.interface.list': 'interface.list',
  'network.ip.addresses': 'ip.addresses',
  'network.ip.routes': 'ip.routes',
  'network.arp.table': 'arp.table',
  'network.dhcp.leases': 'dhcp.leases',
  'network.firewall.summary': 'firewall.summary',
  'network.firewall.list': 'firewall.list',
  'network.diagnostics.ping': 'ping',
  'network.diagnostics.traceroute': 'traceroute',
  'network.firewall.block': 'firewall.block',
  'network.firewall.unblock': 'firewall.unblock',
};

function hasGrant(context, grant) {
  const grants = [
    ...(Array.isArray(context.permissions) ? context.permissions : []),
    ...(Array.isArray(context.scopes) ? context.scopes : []),
    ...(Array.isArray(context.authorizedTools) ? context.authorizedTools : []),
  ];
  return grants.some(value => value === '*' || value === grant || value === 'network:*');
}

function boundedInteger(value, fallback, maximum) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new RangeError(`value must be an integer between 1 and ${maximum}`);
  }
  return number;
}

class NetworkToolsSkill {
  constructor(config = {}, logger = console) {
    this.config = config;
    this.logger = logger;
    this.adapters = new Map(Object.entries(config.networkTools?.adapters || {}));
    if (!this.adapters.has('mikrotik')) {
      this.adapters.set('mikrotik', getManager());
    }
  }

  async authorize(tool, args, context) {
    const userId = context.userId || context._uid;
    if (!userId) return { allowed: false, code: 'AUTHENTICATION_REQUIRED' };

    if (typeof context.authorize === 'function') {
      try {
        const result = await context.authorize(tool, args);
        if (result === true || result?.allowed === true) return { allowed: true };
        return {
          allowed: false,
          code: 'FORBIDDEN',
          reason: result?.reason || 'authorization denied',
        };
      } catch (error) {
        this.logger.warn?.(`[network-tools] authorization failed: ${error.message}`);
        return { allowed: false, code: 'FORBIDDEN', reason: 'authorization failed' };
      }
    }

    const grant = WRITE_TOOLS.has(tool) ? 'network.write' : 'network.read';
    if (hasGrant(context, grant) || hasGrant(context, tool)) return { allowed: true };
    return { allowed: false, code: 'FORBIDDEN', reason: `missing ${grant} permission` };
  }

  resolveProvider(args, context) {
    const provider =
      args.provider ||
      context.provider ||
      this.config.networkTools?.defaultProvider ||
      this.config.defaultProvider;
    if (provider) {
      if (!this.adapters.has(provider))
        throw new Error(`Network provider not configured: ${provider}`);
      return provider;
    }
    if (this.adapters.size === 1) return this.adapters.keys().next().value;
    throw new Error('Network provider is required when multiple providers are configured');
  }

  async execute(tool, args = {}, context = {}) {
    if (tool === 'network.capabilities') {
      return {
        providers: [...this.adapters.keys()],
        tools: [...READ_TOOLS, ...WRITE_TOOLS],
        browserSafe: false,
        authorization: { read: 'network.read', write: 'network.write' },
      };
    }

    if (!READ_TOOLS.has(tool) && !WRITE_TOOLS.has(tool)) {
      throw new Error(`Unsupported network tool: ${tool}`);
    }

    const decision = await this.authorize(tool, args, context);
    if (!decision.allowed) return { authorizationRequired: true, ...decision };

    const provider = this.resolveProvider(args, context);
    const adapter = this.adapters.get(provider);
    const command = TOOL_MAP[tool];
    const normalized = { ...args };
    delete normalized.provider;

    if (tool === 'network.ip.routes' || tool === 'network.firewall.list') {
      normalized.limit = boundedInteger(
        normalized.limit,
        tool === 'network.ip.routes' ? 50 : 100,
        500
      );
    }
    if (tool === 'network.diagnostics.ping') {
      normalized.count = boundedInteger(normalized.count, 4, 100);
    }

    if (typeof adapter.execute === 'function') {
      return adapter.execute(command, normalized, context);
    }
    if (typeof adapter.executeTool === 'function') {
      if (
        adapter.isConnected === false &&
        typeof adapter.connect === 'function' &&
        !(await adapter.connect())
      ) {
        throw new Error(`Network provider '${provider}' is unavailable`);
      }
      return adapter.executeTool(command, normalized);
    }
    throw new TypeError(`Network provider '${provider}' does not expose an execute interface`);
  }
}

export default NetworkToolsSkill;
export { NetworkToolsSkill };
