export const WIFI_OPERATIONS = Object.freeze([
  'scan', 'connect', 'disconnect', 'status', 'isWifiEnabled',
  'setWifiEnabled', 'suggestConnection', 'removeSuggestion',
  'requestPermissions', 'openWifiSettings', 'capabilities'
]);

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
    this.capabilities = new Set(capabilities);
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
    input: { type: 'object', additionalProperties: true }
  }));
}
