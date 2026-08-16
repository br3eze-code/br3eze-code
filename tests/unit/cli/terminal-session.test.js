import { jest } from '@jest/globals';
import {
  supportsInteractiveTerminal,
  createTerminalSpinner,
  createAbortController,
  navigationCommand,
  formatAgentResult
} from '../../../src/cli/terminal-session.js';

describe('terminal session UX', () => {
  test('recognizes Claude-style navigation commands', () => {
    expect(navigationCommand('/back')).toEqual({ action: 'back' });
    expect(navigationCommand('/cancel')).toEqual({ action: 'cancel' });
    expect(navigationCommand('/clear')).toEqual({ action: 'clear' });
    expect(navigationCommand('/help')).toEqual({ action: 'help' });
  });

  test('falls back to plain output when terminal is not interactive', () => {
    expect(supportsInteractiveTerminal({
      stdin: { isTTY: false },
      stdout: { isTTY: false }
    })).toBe(false);
    const output = { isTTY: false, write: jest.fn() };
    const spinner = createTerminalSpinner('working', { stdout: output, interactive: false });
    spinner.stop('success', 'done');
    expect(output.write.mock.calls.flat().join('')).toContain('[working] working');
    expect(output.write.mock.calls.flat().join('')).toContain('[success] done');
  });

  test('aborts on SIGINT and removes its listener', () => {
    const stdin = { isTTY: false, removeListener: jest.fn() };
    const output = { isTTY: false };
    const controller = createAbortController({ stdin, stdout: output });
    process.emit('SIGINT');
    expect(controller.signal.aborted).toBe(true);
    controller.dispose();
    expect(stdin.removeListener).toHaveBeenCalled();
  });

  test('formats structured and plain agent results', () => {
    const output = { write: jest.fn() };
    formatAgentResult({ result: 'hello' }, { output });
    formatAgentResult({ result: { answer: 42 } }, { output, json: true });
    expect(output.write.mock.calls[0][0]).toContain('hello');
    expect(output.write.mock.calls[1][0]).toContain('"answer": 42');
  });
});
