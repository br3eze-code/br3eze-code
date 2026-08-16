import { StarlinkLocalProxy } from '../src/services/starlink/local-grpc-proxy.mjs';

describe('StarlinkLocalProxy', () => {
  function runtime() {
    class Request {
      constructor() { this.dishReboot = undefined; this.dishSetConfig = undefined; }
    }
    const clients = [];
    const proto = { SpaceX: { API: { Device: { Request, Device: class Device {} } } } };
    const grpcModule = {
      credentials: { createInsecure: () => ({ insecure: true }) },
      loadPackageDefinition: () => proto,
    };
    const protoLoaderModule = { loadSync: () => ({}) };
    return { grpcModule, protoLoaderModule, proto, clients };
  }

  test('loads protobuf runtime lazily and maps dish status', async () => {
    const fake = runtime();
    const proxy = new StarlinkLocalProxy({ allowInsecure: true, grpcModule: fake.grpcModule, protoLoaderModule: fake.protoLoaderModule, clientFactory: async ({ address }) => {
      fake.clients.push(address);
      return { handle: (request, callback) => callback(null, { dishGetStatus: { state: 'CONNECTED', uptimeS: '42', signalQuality: 91 } }) };
    } });
    await expect(proxy.getStats('10.0.0.2')).resolves.toMatchObject({ online: true, uptime: '42', signalQuality: 91 });
    await expect(proxy.getStats('10.0.0.2')).resolves.toMatchObject({ online: true });
    expect(fake.clients).toEqual(['10.0.0.2:9200']);
  });

  test('fails closed for mutation without confirmation when no authorizer is configured', async () => {
    const fake = runtime();
    const proxy = new StarlinkLocalProxy({ allowInsecure: true, grpcModule: fake.grpcModule, protoLoaderModule: fake.protoLoaderModule });
    await expect(proxy.reboot('10.0.0.2')).rejects.toThrow('explicit confirmation');
  });

  test('passes mutations through the authorizer and constructs the correct request', async () => {
    const fake = runtime();
    const observed = [];
    const proxy = new StarlinkLocalProxy({ allowInsecure: true, grpcModule: fake.grpcModule, protoLoaderModule: fake.protoLoaderModule, authorize: async (permission, scope) => observed.push({ permission, scope }), clientFactory: async () => ({ handle: (request, callback) => callback(null, { ok: true, request }) }) });
    await expect(proxy.reboot('10.0.0.2', { requestId: 'r-1' })).resolves.toMatchObject({ success: true });
    expect(observed[0].permission).toBe('starlink.local.reboot');
  });
});
