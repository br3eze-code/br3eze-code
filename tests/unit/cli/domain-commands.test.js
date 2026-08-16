import { jest } from '@jest/globals';
import { Command } from 'commander';
import registerCctv from '../../../src/cli/commands/dahua.js';
import registerStarlink from '../../../src/cli/commands/starlink.js';
import registerMikrotik from '../../../src/cli/commands/mikrotik.js';
import registerAgent from '../../../src/cli/commands/agent.js';

function commandNames(command) {
  return command.commands.map((entry) => entry.name());
}

describe('domain CLI command registration', () => {
  test('registers canonical cctv command with dahua compatibility alias', () => {
    const program = new Command();
    registerCctv(program);
    const cctv = program.commands.find((entry) => entry.name() === 'cctv');
    expect(cctv).toBeDefined();
    expect(cctv.aliases()).toContain('dahua');
    expect(commandNames(cctv)).toEqual(expect.arrayContaining([
      'list', 'discover', 'health', 'snapshot', 'channels', 'stream', 'reboot', 'search', 'summarize', 'describe',
    ]));
  });

  test('registers Starlink read and mutation commands', () => {
    const program = new Command();
    registerStarlink(program);
    const starlink = program.commands.find((entry) => entry.name() === 'starlink');
    expect(commandNames(starlink)).toEqual(['list', 'health', 'reboot', 'stow']);
    expect(starlink.commands.find((entry) => entry.name() === 'reboot').options.some((option) => option.long === '--approve')).toBe(true);
  });

  test('registers MikroTik status and approval-gated disconnect commands', () => {
    const program = new Command();
    registerMikrotik(program);
    const mikrotik = program.commands.find((entry) => entry.name() === 'mikrotik');
    expect(commandNames(mikrotik)).toEqual(['status', 'disconnect']);
    expect(mikrotik.commands.find((entry) => entry.name() === 'disconnect').options.some((option) => option.long === '--approve')).toBe(true);
  });

  test('registers generic agent context and scoped skill execution commands', () => {
    const program = new Command();
    registerAgent(program);
    const agent = program.commands.find((entry) => entry.name() === 'agent');
    expect(commandNames(agent)).toEqual(['context', 'run']);
    expect(agent.commands.find((entry) => entry.name() === 'run').options.some((option) => option.long === '--tenant')).toBe(true);
  });
});

describe('domain CLI source safety', () => {
  test('does not rely on CommonJS createRequire in the CCTV command', async () => {
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../../../src/cli/commands/dahua.js', import.meta.url), 'utf8');
    expect(source).not.toContain('createRequire');
    expect(source).not.toContain('require(');
  });
});
