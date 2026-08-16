import { jest } from '@jest/globals';

const connections = [];

class FakeClient {
  constructor() {
    this.handlers = new Map();
    this.execCalls = [];
    connections.push(this);
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    if (event === 'ready') queueMicrotask(() => handler());
    return this;
  }

  connect(options) {
    this.connectOptions = options;
    return this;
  }

  exec(command, options, callback) {
    this.execCalls.push({ command, options });
    const stream = {
      stderr: { on: (_event, handler) => { stream.stderrHandler = handler; } },
      on: (event, handler) => {
        if (event === 'data') stream.dataHandler = handler;
        if (event === 'close') stream.closeHandler = handler;
        return stream;
      }
    };
    callback(null, stream);
    queueMicrotask(() => {
      stream.dataHandler?.(command.includes('distro') ? '{"distro":"test","kernel":"test","uptime":"up","load":"0 0 0","memory":{},"disk":{}}' : 'ok');
      stream.closeHandler?.(0);
    });
    return stream;
  }

  end() { this.ended = true; }
}

jest.unstable_mockModule('ssh2', () => ({ Client: FakeClient }));

const { default: LinuxSkill } = await import('../../../src/skills/linux.js');

describe('LinuxSkill', () => {
  const logger = { warn: jest.fn(), error: jest.fn() };
  const workspace = {
    tenantId: 'tenant-a',
    linux_hosts: {
      edge: {
        driver: 'linux', hostname: '192.0.2.10', port: 22, username: 'agent',
        tenantId: 'tenant-a', allowedUsers: ['user-a']
      }
    }
  };

  beforeEach(() => {
    connections.length = 0;
    jest.clearAllMocks();
  });

  test('requires identity context before remote execution', async () => {
    const skill = new LinuxSkill({ user: 'default' }, logger, workspace);
    await expect(skill.execute('lin.system.info', { host: 'edge' }, {}))
      .rejects.toThrow('authenticated user context');
  });

  test('enforces tenant and host user isolation', async () => {
    const skill = new LinuxSkill({ user: 'default' }, logger, workspace);
    await expect(skill.execute('lin.system.info', { host: 'edge' }, { userId: 'user-a', tenantId: 'tenant-b' }))
      .rejects.toThrow('outside the active tenant');
    await expect(skill.execute('lin.system.info', { host: 'edge' }, { userId: 'user-b', tenantId: 'tenant-a' }))
      .rejects.toThrow('not authorized');
  });

  test('requires approval for mutations', async () => {
    const skill = new LinuxSkill({ user: 'default' }, logger, workspace);
    const ctx = { userId: 'user-a', tenantId: 'tenant-a' };
    await expect(skill.execute('lin.service.restart', { host: 'edge', name: 'agentos.service', reason: 'maintenance' }, ctx))
      .rejects.toThrow('approved action');
    await expect(skill.execute('lin.process.kill', { host: 'edge', pid: 42, reason: 'stuck worker' }, ctx))
      .rejects.toThrow('approved action');
    await expect(skill.execute('lin.system.reboot', { host: 'edge', reason: 'kernel update' }, ctx))
      .rejects.toThrow('approved action');
  });

  test('validates service names, windows, and PIDs before remote calls', async () => {
    const skill = new LinuxSkill({ user: 'default' }, logger, workspace);
    const ctx = { userId: 'user-a', tenantId: 'tenant-a' };
    await expect(skill.execute('lin.service.status', { host: 'edge', name: 'agentos; reboot' }, ctx))
      .rejects.toThrow('Invalid service name');
    await expect(skill.execute('lin.logs.journal', { host: 'edge', unit: 'agentos.service', since: '1x' }, ctx))
      .rejects.toThrow('Invalid log window');
    await expect(skill.execute('lin.process.kill', { host: 'edge', pid: -1, reason: 'bad pid' }, { ...ctx, approval: { status: 'approved' } }))
      .rejects.toThrow('Invalid process id');
    expect(connections).toHaveLength(0);
  });

  test('executes diagnostics through the configured host with non-interactive SSH', async () => {
    const skill = new LinuxSkill({ user: 'default', privateKey: 'KEY' }, logger, workspace);
    const result = await skill.execute('lin.system.info', { host: 'edge' }, { userId: 'user-a', tenantId: 'tenant-a' });
    expect(result).toMatchObject({ distro: 'test', kernel: 'test', uptime: 'up' });
    expect(connections[0].connectOptions).toMatchObject({ host: '192.0.2.10', username: 'agent', privateKey: 'KEY' });
    expect(connections[0].execCalls[0].options).toEqual({ pty: false });
  });
});
