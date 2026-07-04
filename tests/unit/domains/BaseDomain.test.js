'use strict';

const BaseDomain = require('../../../src/domains/BaseDomain');

describe('BaseDomain', () => {
  let domain;

  beforeEach(() => {
    domain = new BaseDomain();
    domain.name = 'testdomain';
  });

  test('starts with sane empty defaults', () => {
    const fresh = new BaseDomain();
    expect(fresh.name).toBe('base');
    expect(fresh.description).toBe('');
    expect(fresh.capabilities).toEqual([]);
    expect(fresh.tools).toEqual([]);
  });

  describe('registerTool', () => {
    test('accepts a valid tool with name and execute()', () => {
      const execute = jest.fn();
      domain.registerTool({ name: 'ping', execute });
      expect(domain.tools).toHaveLength(1);
      expect(domain.tools[0].name).toBe('ping');
    });

    test('rejects a tool missing a name', () => {
      domain.registerTool({ execute: jest.fn() });
      expect(domain.tools).toHaveLength(0);
    });

    test('rejects a tool missing execute()', () => {
      domain.registerTool({ name: 'broken' });
      expect(domain.tools).toHaveLength(0);
    });

    test('rejects a tool whose execute is not a function', () => {
      domain.registerTool({ name: 'broken', execute: 'not-a-function' });
      expect(domain.tools).toHaveLength(0);
    });
  });

  describe('getSkills', () => {
    test('returns all registered tools as an array', () => {
      domain.registerTool({ name: 'a', execute: jest.fn() });
      domain.registerTool({ name: 'b', execute: jest.fn() });
      expect(domain.getSkills()).toHaveLength(2);
      expect(domain.getSkills().map(t => t.name)).toEqual(['a', 'b']);
    });

    test('returns an empty array when nothing is registered', () => {
      expect(domain.getSkills()).toEqual([]);
    });
  });

  describe('getTools', () => {
    test('returns a flat map keyed by "domain.toolName"', () => {
      domain.registerTool({
        name: 'ping',
        description: 'Ping a host',
        risk: 'low',
        execute: jest.fn(),
      });

      const flat = domain.getTools();
      expect(Object.keys(flat)).toEqual(['testdomain.ping']);
      expect(flat['testdomain.ping'].description).toBe('Ping a host');
      expect(flat['testdomain.ping'].risk).toBe('low');
    });

    test('defaults description to the tool name and risk to "low" when unset', () => {
      domain.registerTool({ name: 'reboot', execute: jest.fn() });
      const flat = domain.getTools();
      expect(flat['testdomain.reboot'].description).toBe('reboot');
      expect(flat['testdomain.reboot'].risk).toBe('low');
    });

    test('defaults parameters to an empty object when unset', () => {
      domain.registerTool({ name: 'reboot', execute: jest.fn() });
      expect(domain.getTools()['testdomain.reboot'].parameters).toEqual({});
    });

    test('the wrapped execute() calls the original tool.execute(params) without appending ctx', () => {
      const execute = jest.fn().mockReturnValue('done');
      domain.registerTool({ name: 'ping', execute });

      const flat = domain.getTools();
      const result = flat['testdomain.ping'].execute({ userId: 'u1' }, { host: '1.1.1.1' });

      expect(execute).toHaveBeenCalledWith({ host: '1.1.1.1' });
      expect(result).toBe('done');
    });
  });

  describe('execute', () => {
    test('dispatches to a tool matched by its bare name', async () => {
      const execute = jest.fn().mockResolvedValue({ ok: true });
      domain.registerTool({ name: 'ping', execute });

      const result = await domain.execute({ tool: 'ping', params: { host: '1.1.1.1' } });

      expect(execute).toHaveBeenCalledWith({ host: '1.1.1.1' });
      expect(result).toEqual({ ok: true });
    });

    test('dispatches to a tool matched by its fully-qualified "domain.tool" name', async () => {
      const execute = jest.fn().mockResolvedValue('ok');
      domain.registerTool({ name: 'ping', execute });

      const result = await domain.execute({ tool: 'testdomain.ping', params: {} });
      expect(result).toBe('ok');
    });

    test('throws a clear error when the requested tool does not exist', async () => {
      await expect(domain.execute({ tool: 'nonexistent', params: {} })).rejects.toThrow(
        'Domain "testdomain": tool not found — "nonexistent"'
      );
    });

    test('handles a missing ctx gracefully instead of throwing on destructure', async () => {
      await expect(domain.execute()).rejects.toThrow('tool not found');
    });
  });

  describe('getCapabilities', () => {
    test('returns the explicit capabilities list when set', () => {
      domain.capabilities = ['network', 'diagnostics'];
      domain.registerTool({ name: 'ping', execute: jest.fn() });
      expect(domain.getCapabilities()).toEqual(['network', 'diagnostics']);
    });

    test('falls back to tool names when capabilities is empty', () => {
      domain.registerTool({ name: 'ping', execute: jest.fn() });
      domain.registerTool({ name: 'traceroute', execute: jest.fn() });
      expect(domain.getCapabilities()).toEqual(['ping', 'traceroute']);
    });
  });

  describe('plan', () => {
    test('the default implementation resolves to null (subclasses may override)', async () => {
      await expect(domain.plan('do something')).resolves.toBeNull();
    });
  });
});
