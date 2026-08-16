import dgram from 'dgram';
import chalk from 'chalk';

const DEFAULT_PORT = 5001;
const DEFAULT_HOST = '127.0.0.1';

const THEME = {
  fatal: { color: chalk.bgRed.white.bold, icon: '💀' },
  error: { color: chalk.red.bold, icon: '✘' },
  warn: { color: chalk.yellow.bold, icon: '⚠' },
  success: { color: chalk.green.bold, icon: '✔' },
  info: { color: chalk.blue.bold, icon: 'ℹ' },
  cyber: { color: chalk.cyan.bold, icon: '◆' },
  debug: { color: chalk.magenta.bold, icon: '◇' },
  trace: { color: chalk.gray, icon: '◌' },
};

/**
 * Start the local UDP log viewer. Importing this module is side-effect free.
 * @param {{host?: string, port?: number, json?: boolean}} options
 * @returns {import('dgram').Socket}
 */
export function startLogsDaemon({ host = DEFAULT_HOST, port = DEFAULT_PORT, json = false } = {}) {
  const server = dgram.createSocket('udp4');

  server.on('listening', async () => {
    const address = server.address();
    if (json) {
      console.log(JSON.stringify({ event: 'listening', host: address.address, port: address.port }));
      return;
    }
    let boxen;
    try {
      boxen = (await import('boxen')).default;
    } catch {
      boxen = (text) => `\n${text}\n`;
    }
    console.log(boxen(
      chalk.bold.cyan('AgentOS Logs Daemon') + '\n' +
      chalk.gray(`Listening on ${address.address}:${address.port}\n\n`) +
      chalk.italic('Logs will appear here in real-time.'),
      { padding: 1, margin: 1, borderStyle: 'double', borderColor: 'cyan' },
    ));
  });

  server.on('message', (msg) => {
    const raw = msg.toString();
    try {
      const data = JSON.parse(raw);
      if (json) {
        console.log(JSON.stringify(data));
        return;
      }
      const { level, message, timestamp, service, ...meta } = data;
      const cleanLevel = level ? String(level).replace(/\u001b\[[0-9;]*m/g, '') : 'info';
      const style = THEME[cleanLevel] || THEME.info;
      const timeStr = chalk.gray(`[${timestamp || new Date().toLocaleTimeString()}]`);
      const svcStr = chalk.blue(`[${service || 'agentos'}]`);
      const levelStr = style.color(`${style.icon} ${cleanLevel.toUpperCase().padEnd(7)}`);
      console.log(`${timeStr} ${svcStr} ${levelStr} ${message || ''}`);
      const metaKeys = Object.keys(meta).filter((key) => key !== 'correlationId' && key !== 'stack');
      if (metaKeys.length) console.log(chalk.gray(`  ${JSON.stringify(meta, null, 2).split('\n').join('\n  ')}`));
      if (meta.stack) console.log(chalk.red(`  ${meta.stack.split('\n').slice(1).join('\n  ')}`));
    } catch (error) {
      if (json) console.log(JSON.stringify({ level: 'info', message: raw }));
      else console.log(`${chalk.gray(`[${new Date().toLocaleTimeString()}]`)} ${chalk.blue('[raw]')} ${chalk.magenta(raw)}`);
    }
  });

  server.on('error', (error) => {
    console.error(`Logs daemon error: ${error.stack || error.message}`);
    server.close();
  });

  server.bind(port, host);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startLogsDaemon();
}

export default startLogsDaemon;
