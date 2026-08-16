import readline from 'node:readline';
import { isBack, isCancel } from '../core/interaction/navigation.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const ANSI = Object.freeze({ reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' });

export function supportsInteractiveTerminal({ stdout = process.stdout, stdin = process.stdin } = {}) {
  return Boolean(stdout?.isTTY && stdin?.isTTY && !process.env.NO_COLOR && !process.env.AGENTOS_PLAIN);
}

export function createTerminalSpinner(message, { stdout = process.stdout, interactive = supportsInteractiveTerminal({ stdout }) } = {}) {
  let current = String(message);
  let index = 0;
  let timer = null;
  let stopped = false;

  const render = () => {
    if (!interactive || stopped) return;
    stdout.write(`\r\x1b[K  ${ANSI.cyan}${SPINNER_FRAMES[index % SPINNER_FRAMES.length]}${ANSI.reset} ${current}`);
    index += 1;
  };

  if (interactive) {
    render();
    timer = setInterval(render, 80);
    timer.unref?.();
  } else {
    stdout.write(`[working] ${current}\n`);
  }

  return {
    update(nextMessage) {
      current = String(nextMessage);
      render();
    },
    stop(status = 'success', finalMessage = current) {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      const symbol = status === 'success' ? '✓' : status === 'cancelled' ? '⏸' : '✗';
      const color = status === 'success' ? ANSI.green : status === 'cancelled' ? ANSI.yellow : ANSI.red;
      if (interactive) stdout.write(`\r\x1b[K  ${color}${symbol}${ANSI.reset} ${finalMessage}\n`);
      else stdout.write(`[${status}] ${finalMessage}\n`);
    }
  };
}

export function createAbortController({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const controller = new AbortController();
  const onSigint = () => controller.abort(new Error('Operation cancelled by user'));
  const onKeypress = (_input, key) => {
    if (key?.name === 'escape') controller.abort(new Error('Operation cancelled by user'));
  };
  process.once('SIGINT', onSigint);
  if (stdin.isTTY) readline.emitKeypressEvents(stdin);
  if (stdin.isTTY && stdout.isTTY) stdin.on('keypress', onKeypress);
  return {
    signal: controller.signal,
    abort: () => controller.abort(new Error('Operation cancelled by user')),
    dispose() {
      process.removeListener('SIGINT', onSigint);
      stdin.removeListener?.('keypress', onKeypress);
    }
  };
}

export function navigationCommand(input) {
  if (isBack(input)) return { action: 'back' };
  if (isCancel(input)) return { action: 'cancel' };
  if (input?.trim().toLowerCase() === '/clear') return { action: 'clear' };
  if (input?.trim().toLowerCase() === '/help') return { action: 'help' };
  return null;
}

export function createQueuedRepl({ dispatch, renderResult, json = false, prompt = '› ', input = process.stdin, output = process.stdout }) {
  const rl = readline.createInterface({ input, output, prompt, terminal: Boolean(input.isTTY && output.isTTY) });
  let busy = false;
  let closed = false;
  let active = null;

  const close = () => {
    if (closed) return;
    closed = true;
    active?.abort?.();
    rl.close();
  };

  const handleLine = async (line) => {
    const text = String(line ?? '').trim();
    const nav = navigationCommand(text);
    if (nav?.action === 'cancel') {
      active?.abort?.();
      output.write('⏸ Cancelled.\n');
      return rl.prompt();
    }
    if (nav?.action === 'back') {
      output.write('← Back.\n');
      return rl.prompt();
    }
    if (nav?.action === 'clear') {
      output.write('\x1b[2J\x1b[H');
      return rl.prompt();
    }
    if (nav?.action === 'help') {
      output.write('Commands: /help, /clear, /back, /cancel, /exit\n');
      return rl.prompt();
    }
    if (!text) return rl.prompt();
    if (isCancel(text)) return close();
    if (busy) {
      output.write('[queued] Your message will run after the active request.\n');
      return rl.prompt();
    }

    busy = true;
    active = createAbortController({ stdin: input, stdout: output });
    const spinner = createTerminalSpinner('AgentOS is working', { stdout: output });
    try {
      const result = await dispatch(text, { signal: active.signal });
      spinner.stop('success', 'AgentOS completed');
      renderResult(result, { json, output });
    } catch (error) {
      const cancelled = active.signal.aborted || /cancelled/i.test(error?.message || '');
      spinner.stop(cancelled ? 'cancelled' : 'error', cancelled ? 'Operation cancelled' : `Error: ${error.message}`);
    } finally {
      active.dispose();
      active = null;
      busy = false;
      if (!closed) rl.prompt();
    }
  };

  rl.on('line', (line) => { void handleLine(line); });
  rl.on('SIGINT', () => {
    if (busy) active?.abort?.();
    else close();
  });
  rl.on('close', () => { closed = true; output.write('\nGoodbye.\n'); });
  rl.prompt();
  return { rl, close };
}

export function formatAgentResult(result, { json = false, output = process.stdout } = {}) {
  if (json) output.write(`${JSON.stringify(result, null, 2)}\n`);
  else output.write(`${typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result ?? result, null, 2)}\n`);
}
