import { describe, expect, test, jest } from '@jest/globals';
import IronWiFiAdapter from '../../src/adapters/network/ironwifi-adapter.js';

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return payload; },
  };
}

function makeAdapter(config = {}) {
  const fetchImpl = jest.fn().mockResolvedValue(response(200, { ok: true }));
  const adapter = new IronWiFiAdapter({
    apiToken: 'EXAMPLE_API_KEY_VALUE',
    fetchImpl,
    ...config,
  });
  return { adapter, fetchImpl };
}

describe('IronWiFiAdapter', () => {
  test('uses HTTPS bearer authentication and the versioned users route', async () => {
    const { adapter, fetchImpl } = makeAdapter();
    await adapter.executeTool('wifi.users.list', { query: { page: 2, page_size: 25 } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://console.ironwifi.com/api/v2/users?page=2&page_size=25');
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer EXAMPLE_API_KEY_VALUE');
    expect(options.redirect).toBe('error');
  });

  test('places company scope in documented users and non-versioned resource paths', async () => {
    const { adapter, fetchImpl } = makeAdapter({ companyId: 'company-1' });
    await adapter.listUsers();
    await adapter.listNetworks();

    expect(fetchImpl.mock.calls[0][0]).toBe('https://console.ironwifi.com/api/v2/company-1/users');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://console.ironwifi.com/api/company-1/networks');
  });

  test('blocks mutations unless trusted host configuration enables writes', async () => {
    const { adapter, fetchImpl } = makeAdapter();
    await expect(adapter.createVoucher({ duration: 3600, count: 1 }))
      .rejects.toMatchObject({ code: 'IRONWIFI_WRITES_DISABLED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sends an explicitly enabled voucher creation request', async () => {
    const { adapter, fetchImpl } = makeAdapter({ allowWrites: true });
    await adapter.createVoucher({ table_id: 'group-1', duration: 3600, count: 2 });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://console.ironwifi.com/api/vouchers');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ table_id: 'group-1', duration: 3600, count: 2 });
  });

  test('rejects non-official hosts and insecure base URLs', () => {
    expect(() => makeAdapter({ baseUrl: 'https://ironwifi.com.attacker.example/api' }))
      .toThrow(/official ironwifi/);
    expect(() => makeAdapter({ baseUrl: 'http://console.ironwifi.com/api' }))
      .toThrow(/HTTPS/);
  });

  test('does not expose provider response bodies in errors', async () => {
    const { adapter, fetchImpl } = makeAdapter();
    fetchImpl.mockResolvedValue(response(401, { detail: 'private account information' }));

    await expect(adapter.listUsers()).rejects.toMatchObject({
      code: 'IRONWIFI_HTTP_ERROR',
      status: 401,
    });
    await expect(adapter.listUsers()).rejects.not.toThrow(/private account information/);
  });

  test('rejects unknown action names', async () => {
    const { adapter, fetchImpl } = makeAdapter();
    await expect(adapter.executeTool('wifi.router.reboot')).rejects.toMatchObject({
      code: 'IRONWIFI_UNSUPPORTED_ACTION',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('requires a configured API token before making a request', async () => {
    const fetchImpl = jest.fn();
    const adapter = new IronWiFiAdapter({ fetchImpl });
    await expect(adapter.listNetworks()).rejects.toThrow(/API token is not configured/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
