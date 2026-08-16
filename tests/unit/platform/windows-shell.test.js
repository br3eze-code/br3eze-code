import { jest } from '@jest/globals';
import { CmdAdapter, PowerShellAdapter } from '../../../src/platform/windows-shell.js';

describe('Windows shell adapters', () => {
  const context = { userId: 'u1', tenantId: 't1', domain: 'generic', siteId: 's1', role: 'operator' };
  const executor = jest.fn(async (file, args, options) => ({ stdout: `${file}:${args.join('|')}`, stderr: '', options }));

  beforeEach(() => executor.mockClear());

  test.each([
    ['PowerShell', PowerShellAdapter],
    ['CMD', CmdAdapter],
  ])('%s executes read commands without a shell and emits scoped audit metadata', async (_name, Adapter) => {
    const audit = [];
    const adapter = new Adapter({ executor, auditSink: (event) => audit.push(event) });
    const result = await adapter.execute('identity', [], context);
    expect(result.shell).toBe(_name === 'PowerShell' ? 'powershell' : 'cmd');
    expect(executor).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ shell: false }));
    expect(audit[0]).toMatchObject({ userId: 'u1', tenantId: 't1', domain: 'generic', siteId: 's1', command: 'identity' });
  });

  test('rejects anonymous and cross-tenant execution context', async () => {
    const adapter = new CmdAdapter({ executor });
    await expect(adapter.execute('identity', [], {})).rejects.toThrow(/userId/);
    await expect(adapter.execute('identity', [], { userId: 'u1' })).rejects.toThrow(/tenantId/);
    expect(executor).not.toHaveBeenCalled();
  });

  test.each([
    ['stop_process', ['1; whoami'], 'Process ID must be numeric'],
    ['stop_service', ['spooler & whoami'], 'unsafe characters'],
    ['stop_service', [''], 'Invalid argument'],
  ])('rejects unsafe %s arguments before process execution', async (command, args, message) => {
    const adapter = new CmdAdapter({ executor });
    await expect(adapter.execute(command, args, { ...context, approval: { approved: true, userId: 'u1' } })).rejects.toThrow(message);
    expect(executor).not.toHaveBeenCalled();
  });

  test('requires matching explicit approval for mutations', async () => {
    const adapter = new PowerShellAdapter({ executor });
    await expect(adapter.execute('stop_process', ['42'], context)).rejects.toThrow(/approval/);
    await expect(adapter.execute('stop_process', ['42'], { ...context, approval: { approved: true, userId: 'other' } })).rejects.toThrow(/does not match/);
    await adapter.execute('stop_process', ['42'], { ...context, approval: { approved: true, userId: 'u1' } });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  test('does not accept arbitrary executable names or multiple arguments', async () => {
    const adapter = new CmdAdapter({ executor });
    await expect(adapter.execute('powershell.exe', ['-Command', 'whoami'], context)).rejects.toThrow(/Unsupported/);
    await expect(adapter.execute('identity', ['extra'], context)).rejects.toThrow(/zero arguments/);
    expect(executor).not.toHaveBeenCalled();
  });
});
