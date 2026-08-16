import { EventEmitter } from 'node:events';
import path from 'node:path';

const DEFAULT_PROTO_PATH = process.env.STARLINK_DEVICE_PROTO || '/opt/agentos/starlink/protos/device.proto';
const DEFAULT_PORT = Number(process.env.STARLINK_DEVICE_GRPC_PORT || 9200);

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
}

export class StarlinkLocalProxy extends EventEmitter {
  constructor({
    protoPath = DEFAULT_PROTO_PATH,
    port = DEFAULT_PORT,
    tls = null,
    allowInsecure = process.env.STARLINK_LOCAL_PROXY_ALLOW_INSECURE === 'true',
    grpcModule = null,
    protoLoaderModule = null,
    clientFactory = null,
    authorize = null,
    requestTimeoutMs = 10_000,
  } = {}) {
    super();
    this.protoPath = path.resolve(protoPath);
    this.port = port;
    this.tls = tls;
    this.allowInsecure = allowInsecure;
    this.grpcModule = grpcModule;
    this.protoLoaderModule = protoLoaderModule;
    this.clientFactory = clientFactory;
    this.authorize = authorize;
    this.requestTimeoutMs = requestTimeoutMs;
    this.clients = new Map();
    this._runtime = null;
  }

  async #loadRuntime() {
    if (this._runtime) return this._runtime;
    const grpc = this.grpcModule || await import('@grpc/grpc-js');
    const protoLoader = this.protoLoaderModule || await import('@grpc/proto-loader');
    const grpcApi = grpc.default || grpc;
    const loaderApi = protoLoader.default || protoLoader;
    const packageDef = loaderApi.loadSync(this.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpcApi.loadPackageDefinition(packageDef);
    this._runtime = { grpc: grpcApi, proto };
    return this._runtime;
  }

  #credentials(runtime) {
    if (this.tls?.rootCert) {
      return runtime.grpc.credentials.createSsl(
        Buffer.from(this.tls.rootCert),
        this.tls.clientKey ? Buffer.from(this.tls.clientKey) : undefined,
        this.tls.clientCert ? Buffer.from(this.tls.clientCert) : undefined,
      );
    }
    if (this.allowInsecure) return runtime.grpc.credentials.createInsecure();
    throw new Error('Starlink local gRPC TLS is required; set tls.rootCert or explicitly enable STARLINK_LOCAL_PROXY_ALLOW_INSECURE=true for an isolated lab network');
  }

  #deviceConstructor(proto) {
    const Device = proto?.SpaceX?.API?.Device?.Device;
    if (typeof Device !== 'function') {
      throw new Error(`Starlink device service is missing from protobuf package: ${this.protoPath}`);
    }
    return Device;
  }

  async connect(terminalIp, context = {}) {
    required(terminalIp, 'terminalIp');
    if (this.authorize) await this.authorize('starlink.local.connect', { terminalIp, context });
    const key = `${terminalIp}:${this.port}`;
    if (this.clients.has(key)) return this.clients.get(key);
    const runtime = await this.#loadRuntime();
    const address = `${terminalIp}:${this.port}`;
    const client = this.clientFactory
      ? await this.clientFactory({ address, credentials: this.#credentials(runtime), proto: runtime.proto, grpc: runtime.grpc })
      : new (this.#deviceConstructor(runtime.proto))(address, this.#credentials(runtime));
    this.clients.set(key, client);
    this.emit('connected', { terminalIp, port: this.port });
    return client;
  }

  async close(terminalIp = null) {
    const entries = terminalIp ? [...this.clients.entries()].filter(([key]) => key.startsWith(`${terminalIp}:`)) : [...this.clients.entries()];
    for (const [key, client] of entries) {
      client.close?.();
      this.clients.delete(key);
    }
  }

  #request(client, request, context = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Starlink local gRPC request timed out'));
        }
      }, this.requestTimeoutMs);
      client.handle(request, (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) return reject(error);
        resolve(response);
      });
    });
  }

  async getStats(terminalIp, context = {}) {
    const runtime = await this.#loadRuntime();
    const client = await this.connect(terminalIp, context);
    const Request = runtime.proto?.SpaceX?.API?.Device?.Request;
    if (typeof Request !== 'function') throw new Error('Starlink device Request message is missing from protobuf package');
    const response = await this.#request(client, new Request(), context);
    const dish = response?.dishGetStatus;
    return {
      online: dish?.state === 'CONNECTED',
      state: dish?.state,
      uptime: dish?.uptimeS,
      signalQuality: dish?.signalQuality,
      downlinkThroughput: dish?.downlinkThroughputBps,
      uplinkThroughput: dish?.uplinkThroughputBps,
      latency: dish?.popPingLatencyMs,
      obstructionFraction: dish?.obstructionStats?.fractionObstructed,
      snr: dish?.snr,
      hardwareVersion: dish?.hardwareVersion,
      softwareVersion: dish?.softwareVersion,
      alerts: dish?.alerts || {},
    };
  }

  async reboot(terminalIp, context = {}) {
    return this.#mutate(terminalIp, 'starlink.local.reboot', (Request) => { const request = new Request(); request.dishReboot = {}; return request; }, context);
  }

  async setConfig(terminalIp, config, context = {}) {
    if (!config || typeof config !== 'object') throw new TypeError('config must be an object');
    return this.#mutate(terminalIp, 'starlink.local.setConfig', (Request) => { const request = new Request(); request.dishSetConfig = config; return request; }, context);
  }

  async #mutate(terminalIp, permission, makeRequest, context) {
    if (this.authorize) await this.authorize(permission, { terminalIp, context, mutation: true });
    else if (!context.confirmed) throw new Error('Mutation requires explicit confirmation');
    const runtime = await this.#loadRuntime();
    const Request = runtime.proto?.SpaceX?.API?.Device?.Request;
    const client = await this.connect(terminalIp, context);
    const response = await this.#request(client, makeRequest(Request), context);
    const result = { success: true, terminalIp, response };
    this.emit('mutation', { permission, terminalIp, context: { requestId: context.requestId } });
    return result;
  }
}

export default StarlinkLocalProxy;
