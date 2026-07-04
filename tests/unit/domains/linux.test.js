'use strict';

jest.mock('child_process', () => {
  const util = require('util');
  const mockExec = jest.fn();
  // Node's real child_process.exec has a util.promisify.custom implementation
  // that resolves to { stdout, stderr } instead of just the callback's single
  // result value. A plain jest.fn() mock doesn't have that, so util.promisify
  // would otherwise only capture the callback's *second* argument (stdout)
  // and never populate stderr — reproducing that behavior here.
  mockExec[util.promisify.custom] = (command) =>
    new Promise((resolve, reject) => {
      mockExec(command, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ stdout, stderr });
      });
    });
  return { exec: mockExec };
});

const { exec } = require('child_process');
const LinuxDomain = require('../../../src/domains/linux');

describe('LinuxDomain', () => {
  let domain;
  beforeEach(() => {
    jest.clearAllMocks();
    domain = new LinuxDomain();
  });

  test('registers shell and uptime tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['shell', 'uptime']);
  });

  test('shell() returns stdout on success', async () => {
    exec.mockImplementation((cmd, cb) => cb(null, 'file1.txt\nfile2.txt\n', ''));

    const result = await domain.execute({ tool: 'shell', params: 'ls' });
    expect(result).toBe('file1.txt\nfile2.txt\n');
  });

  test('shell() falls back to stderr when stdout is empty', async () => {
    exec.mockImplementation((cmd, cb) => cb(null, '', 'warning: something'));

    const result = await domain.execute({ tool: 'shell', params: 'somecmd' });
    expect(result).toBe('warning: something');
  });

  test('shell() returns a formatted error string instead of throwing on command failure', async () => {
    exec.mockImplementation((cmd, cb) => cb(new Error('command not found: bogus'), '', ''));

    const result = await domain.execute({ tool: 'shell', params: 'bogus' });
    expect(result).toBe('Error: command not found: bogus');
  });

  test('shell() passes the exact command string through to child_process.exec', async () => {
    exec.mockImplementation((cmd, cb) => cb(null, 'ok', ''));

    await domain.execute({ tool: 'shell', params: 'whoami' });
    expect(exec).toHaveBeenCalledWith('whoami', expect.any(Function));
  });

  test('uptime() returns the trimmed output of `uptime -p`', async () => {
    exec.mockImplementation((cmd, cb) => cb(null, 'up 3 days, 2 hours\n', ''));

    const result = await domain.execute({ tool: 'uptime', params: undefined });
    expect(result).toBe('up 3 days, 2 hours');
    expect(exec).toHaveBeenCalledWith('uptime -p', expect.any(Function));
  });
});
