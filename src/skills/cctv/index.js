import { BaseSkill } from '../base.js';
import HikvisionSkill from '../hikivision/index.js';
import DahuaSkill from '../dahua/index.js';

const PROVIDERS = new Map([
  ['hikvision', { prefix: 'hik', key: 'hikvision_devices', Skill: HikvisionSkill }],
  ['dahua', { prefix: 'dahua', key: 'dahua_devices', Skill: DahuaSkill }],
]);

const ACTIONS = {
  'device.info': 'device.info',
  'channel.list': 'device.channels',
  'snapshot.get': 'snapshot.get',
  'stream.url': 'stream.url',
  'ptz.move': 'ptz.move',
  'ptz.preset': 'ptz.preset',
  'events.search': 'events.search',
  'system.reboot': 'system.reboot',
};

const STREAM_URL_FIELDS = ['url', 'main', 'sub'];

function redactStreamUrl(value) {
  if (typeof value !== 'string' || !value) return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch (_) {
    return value.replace(/(\w+:\/\/)([^:@/]+)(?::[^@/]*)?@/i, '$1');
  }
}

function hasGrant(ctx, grant) {
  const grants = [
    ...(Array.isArray(ctx?.permissions) ? ctx.permissions : []),
    ...(Array.isArray(ctx?.scopes) ? ctx.scopes : []),
    ...(Array.isArray(ctx?.authorizedTools) ? ctx.authorizedTools : []),
  ].map(String);
  return grants.some((entry) => entry === '*' || entry === 'cctv:*' || entry === grant);
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'hik' || provider === 'hikivision') return 'hikvision';
  if (provider === 'dahua') return 'dahua';
  return provider;
}

class CctvSkill extends BaseSkill {
  static id = 'cctv';
  static name = 'CCTV';
  static description = 'Vendor-neutral CCTV operations across configured providers';

  constructor(config, logger, workspace) {
    super(config, logger, workspace || config?.workspace || {});
    this.adapters = new Map();
  }

  _workspace() {
    return this.workspace || this.config?.workspace || {};
  }

  _adapter(provider) {
    const name = normalizeProvider(provider);
    const definition = PROVIDERS.get(name);
    if (!definition) throw new Error(`Unsupported CCTV provider: ${provider}`);
    if (!this.adapters.has(name)) {
      this.adapters.set(name, new definition.Skill(this.config, this.logger, this._workspace()));
    }
    return { name, definition, skill: this.adapters.get(name) };
  }

  _providerFor(device, requested) {
    const explicit = normalizeProvider(requested);
    if (explicit) return explicit;
    const workspace = this._workspace();
    const matches = [...PROVIDERS.entries()].filter(([, definition]) =>
      Object.prototype.hasOwnProperty.call(workspace[definition.key] || {}, device)
    );
    if (matches.length === 1) return matches[0][0];
    if (matches.length > 1) throw new Error(`CCTV device ${device} is ambiguous; specify provider.`);
    throw new Error(`CCTV device ${device} is not configured.`);
  }

  async _list(provider) {
    const names = provider ? [normalizeProvider(provider)] : [...PROVIDERS.keys()];
    const devices = [];
    for (const name of names) {
      const { definition, skill } = this._adapter(name);
      const rows = await skill.execute(`${definition.prefix}.device.list`, {}, { userId: null });
      for (const row of Array.isArray(rows) ? rows : []) devices.push({ ...row, provider: name });
    }
    return devices;
  }

  async _channels(provider, device, ctx) {
    const { definition, skill } = this._adapter(provider);
    const result = await skill.execute(`${definition.prefix}.device.channels`, { device }, ctx);
    const rows = Array.isArray(result) ? result : result?.channels || [];
    return rows.map((row) => ({
      channel: Number(row.channel ?? row.id),
      name: row.name || row.channelName || `Channel ${row.channel ?? row.id}`,
      enabled: row.enabled !== false,
      provider,
      device,
      videoCodec: row.videoCodec || null,
    })).filter((row) => Number.isInteger(row.channel) && row.channel > 0);
  }

  _requestedChannels(channels) {
    if (channels === undefined || channels === null || channels === '') return null;
    if (!Array.isArray(channels)) channels = [channels];
    const normalized = [...new Set(channels.map((channel) => Number(channel)))];
    if (!normalized.length || normalized.some((channel) => !Number.isInteger(channel) || channel <= 0)) {
      throw new Error('channels must contain positive integer NVR channel identifiers');
    }
    if (normalized.length > 64) throw new Error('A maximum of 64 NVR channels may be streamed per request');
    return normalized;
  }

  async _authorizeMultiStream(ctx, request) {
    const identity = ctx?.userId || ctx?._uid;
    if (!identity) return { allowed: false, code: 'AUTHENTICATION_REQUIRED', reason: 'An authenticated user is required for multi-channel streaming' };

    if (typeof ctx.authorize === 'function') {
      try {
        const decision = await ctx.authorize('cctv.stream.multi', request);
        if (decision === true || decision?.allowed === true) return { allowed: true, source: 'authorize' };
        return { allowed: false, code: 'FORBIDDEN', reason: decision?.reason || 'Streaming permission was denied' };
      } catch (error) {
        this.logger?.warn?.('CCTV multi-stream authorization failed', { user: identity, error: error.message });
        return { allowed: false, code: 'FORBIDDEN', reason: 'Streaming authorization could not be verified' };
      }
    }

    const grants = [
      ...(Array.isArray(ctx.permissions) ? ctx.permissions : []),
      ...(Array.isArray(ctx.scopes) ? ctx.scopes : []),
      ...(Array.isArray(ctx.authorizedTools) ? ctx.authorizedTools : []),
      ...(Array.isArray(ctx.cctvAccess) ? ctx.cctvAccess : []),
    ].map(String);
    const allowed = ctx.cctvAccess === true || grants.some((grant) => [
      '*', 'cctv:*', 'cctv.stream', 'cctv.stream.multi', 'cctv:stream', 'cctv:stream:multi'
    ].includes(grant));
    if (allowed) return { allowed: true, source: 'grant' };
    return { allowed: false, code: 'FORBIDDEN', reason: 'cctv.stream.multi permission is required' };
  }

  _streamPolicy(ctx) {
    const exposeCredentials = ctx?.exposeCredentials === true && hasGrant(ctx, 'cctv.stream.credentials');
    return {
      transport: 'rtsp',
      browserCompatible: false,
      credentialedUrlsExposed: exposeCredentials,
      recommendation: 'Use a server-side RTSP-to-WebRTC or HLS media gateway for browser playback.',
    };
  }

  _secureStream(stream, ctx) {
    if (!stream || typeof stream !== 'object') return stream;
    const exposeCredentials = this._streamPolicy(ctx).credentialedUrlsExposed;
    const result = { ...stream, security: this._streamPolicy(ctx) };
    for (const field of STREAM_URL_FIELDS) {
      if (typeof result[field] === 'string' && !exposeCredentials) {
        result[field] = redactStreamUrl(result[field]);
      }
    }
    return result;
  }

  async _capabilities(provider, device) {
    const { name } = this._adapter(provider);
    const configured = this._workspace()[`${name}_devices`]?.[device]?.capabilities || {};
    return {
      device,
      provider: name,
      standards: configured.standards || ['rtsp'],
      profiles: configured.profiles || (name === 'dahua' ? ['vendor-api', 'rtsp'] : ['vendor-api', 'rtsp']),
      features: {
        channels: true,
        snapshot: true,
        multiChannelStreaming: true,
        ptz: configured.ptz !== false,
        events: configured.events !== false,
        analyticsMetadata: configured.analyticsMetadata === true,
        browserPlayback: configured.browserPlayback === true,
      },
      media: {
        browserTransport: configured.browserTransport || null,
        serverGatewayRequired: configured.browserPlayback !== true,
      },
    };
  }

  async _multiStream(provider, device, args, ctx) {
    const requested = this._requestedChannels(args.channels);
    const authorization = await this._authorizeMultiStream(ctx, {
      device,
      provider,
      channels: requested,
      requestedChannelCount: requested?.length || null,
      subtype: args.subtype,
    });
    if (!authorization.allowed) return { authorizationRequired: true, ...authorization, device, provider };

    const { definition, skill } = this._adapter(provider);
    const available = await this._channels(provider, device, ctx);
    const selected = (requested ? available.filter((row) => requested.includes(row.channel)) : available.filter((row) => row.enabled));
    if (requested && selected.length !== requested.length) {
      const found = new Set(selected.map((row) => row.channel));
      const missing = requested.filter((channel) => !found.has(channel));
      throw new Error(`NVR channel(s) not available on ${device}: ${missing.join(', ')}`);
    }
    if (!selected.length) return { device, provider, channels: [], note: 'No enabled NVR channels are configured.' };

    const channels = await Promise.all(selected.map(async (row) => {
      const stream = await skill.execute(`${definition.prefix}.stream.url`, {
        device,
        channel: row.channel,
        subtype: args.subtype,
      }, ctx);
      return { ...row, stream: this._secureStream(stream, ctx) };
    }));
    return { device, provider, channels };
  }

  async execute(toolName, args = {}, ctx = {}) {
    const action = toolName.replace(/^cctv\./, '');
    if (action === 'device.list') return this._list(args.provider);
    if (action === 'capabilities') {
      const provider = this._providerFor(args.device, args.provider);
      return this._capabilities(provider, args.device);
    }
    if (action === 'device.health') {
      const provider = args.provider ? normalizeProvider(args.provider) : null;
      if (provider) return { provider, ...(await this._adapter(provider).skill.healthCheck()) };
      return this.healthCheck();
    }
    if (action === 'channel.list') {
      const provider = this._providerFor(args.device, args.provider);
      return { device: args.device, provider, channels: await this._channels(provider, args.device, ctx) };
    }
    if (action === 'stream.multi') {
      const provider = this._providerFor(args.device, args.provider);
      return this._multiStream(provider, args.device, args, ctx);
    }
    if (action === 'snapshot.all') {
      const provider = this._providerFor(args.device, args.provider);
      if (provider !== 'dahua') throw new Error('snapshot.all is currently supported by the Dahua adapter only');
      return this._adapter(provider).skill.execute('dahua.snapshot.getAll', args, ctx);
    }
    if (action === 'scene.describe' || action === 'events.summarize') {
      const provider = this._providerFor(args.device, args.provider);
      if (provider !== 'dahua') throw new Error(`${action} is currently supported by the Dahua adapter only`);
      return this._adapter(provider).skill.execute(`dahua.${action}`, args, ctx);
    }
    if (action === 'device.discover') {
      const { skill } = this._adapter('dahua');
      return skill.execute('dahua.device.discover', args, ctx);
    }

    const provider = this._providerFor(args.device, args.provider);
    const { definition, skill } = this._adapter(provider);
    const vendorAction = ACTIONS[action];
    if (!vendorAction) throw new Error(`Unknown CCTV operation: ${toolName}`);
    const result = await skill.execute(`${definition.prefix}.${vendorAction}`, args, ctx);
    return action === 'stream.url' ? this._secureStream(result, ctx) : result;
  }

  async healthCheck() {
    const results = [];
    for (const provider of PROVIDERS.keys()) {
      const { skill } = this._adapter(provider);
      if (typeof skill.healthCheck !== 'function') continue;
      results.push({ provider, ...(await skill.healthCheck()) });
    }
    return {
      status: results.every((result) => result.status === 'ok') ? 'ok' : 'degraded',
      providers: results,
    };
  }
}

export default CctvSkill;
