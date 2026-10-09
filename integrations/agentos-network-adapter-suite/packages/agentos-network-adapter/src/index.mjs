const stringSchema = {
  type: 'string',
  minLength: 1
};

export const WIFI_OPERATIONS = Object.freeze([
  'scan', 'connect', 'disconnect', 'getConnectionInfo', 'status', 'isWifiEnabled',
  'setWifiEnabled', 'suggestConnection', 'removeSuggestion',
  'requestPermissions', 'openWifiSettings', 'capabilities'
]);

export const WIFI_OPERATION_SCHEMAS = Object.freeze({
  scan: { type: 'object', properties: {}, additionalProperties: false },
  connect: { type: 'object', properties: { ssid: stringSchema, password: { type: 'string' }, profile: stringSchema, device: stringSchema }, additionalProperties: false },
  disconnect: { type: 'object', properties: { device: stringSchema, ssid: stringSchema }, additionalProperties: false },
  getConnectionInfo: { type: 'object', properties: {}, additionalProperties: false },
  status: { type: 'object', properties: {}, additionalProperties: false },
  isWifiEnabled: { type: 'object', properties: {}, additionalProperties: false },
  setWifiEnabled: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false },
  suggestConnection: { type: 'object', properties: { ssid: stringSchema, password: { type: 'string' } }, required: ['ssid'], additionalProperties: false },
  removeSuggestion: { type: 'object', properties: { ssid: stringSchema }, additionalProperties: false },
  requestPermissions: { type: 'object', properties: {}, additionalProperties: false },
  openWifiSettings: { type: 'object', properties: {}, additionalProperties: false },
  capabilities: { type: 'object', properties: {}, additionalProperties: false }
});

export class NetworkAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NetworkAdapterError';
    this.code = code;
    this.details = details;
  }
}

export class NetworkAdapter {
  constructor({ id, platform, capabilities = [], transport }) {
    if (!id || !platform || !transport) throw new TypeError('id, platform and transport are required');
    this.id = id;
    this.platform = platform;
    this.capabilities = new Set(capabilities.filter(op => WIFI_OPERATIONS.includes(op)));
    this.transport = transport;
  }

  hasCapability(name) { return this.capabilities.has(name); }

  async execute(operation, args = {}) {
    if (!WIFI_OPERATIONS.includes(operation)) {
      throw new NetworkAdapterError('UNKNOWN_OPERATION', `Unsupported operation: ${operation}`);
    }
    if (!this.hasCapability(operation)) {
      throw new NetworkAdapterError('UNSUPPORTED_CAPABILITY', `${operation} is not supported by ${this.id}`, { operation, platform: this.platform });
    }
    if (args == null || typeof args !== 'object' || Array.isArray(args)) {
      throw new NetworkAdapterError('INVALID_ARGUMENTS', `${operation} requires an object argument`, { operation });
    }
    return this.transport(operation, args);
  }

  describe() {
    return { id: this.id, platform: this.platform, capabilities: [...this.capabilities].sort() };
  }
}

export function createToolDescriptors(adapter) {
  return WIFI_OPERATIONS.filter(op => adapter.hasCapability(op)).map(name => ({
    name: `network.wifi.${name}`,
    description: `Execute Wi-Fi operation ${name} through the ${adapter.id} adapter.`,
    input: WIFI_OPERATION_SCHEMAS[name]
  }));
}
