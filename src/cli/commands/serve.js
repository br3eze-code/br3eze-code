import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export default function registerServeCommand(program) {
  program
    .command('serve')
    .description('Serve the PWA HTML pages and canonical API routes locally')
    .option('--mode <mode>', 'Serving mode: dev or prod', 'dev')
    .option('--host <host>', 'Bind address (default: 127.0.0.1)')
    .option('--port <port>', 'HTTP port', value => Number.parseInt(value, 10))
    .action(async options => {
      if (!['dev', 'prod'].includes(options.mode)) {
        console.error('Mode must be either dev or prod.');
        process.exitCode = 2;
        return;
      }
      const host = options.host || process.env.HOST || '127.0.0.1';
      const port = options.port || Number(process.env.PORT || 3000);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error('Port must be an integer between 1 and 65535.');
        process.exitCode = 2;
        return;
      }
      if (options.mode === 'prod') {
        const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'serve:prod'], {
          cwd: root, stdio: 'inherit', env: { ...process.env, HOST: host, PORT: String(port) }, shell: false
        });
        child.on('error', error => { console.error(error.message); process.exitCode = 1; });
        child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
        return;
      }
      const child = spawn(process.execPath, ['scripts/serve.mjs', '--mode=dev'], {
        cwd: root, stdio: 'inherit', env: { ...process.env, HOST: host, PORT: String(port), NODE_ENV: 'development' }, shell: false
      });
      child.on('error', error => { console.error(error.message); process.exitCode = 1; });
      child.on('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
    });
}
