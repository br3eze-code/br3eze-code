import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const READ_COMMANDS = Object.freeze({
  version: { powershell: '$PSVersionTable.PSVersion.ToString()', cmd: ['cmd.exe', ['/d', '/s', '/c', 'ver']] },
  identity: { powershell: '[Security.Principal.WindowsIdentity]::GetCurrent().Name', cmd: ['whoami.exe', []] },
  processes: { powershell: 'Get-Process | Select-Object -First 50 Name,Id,CPU | ConvertTo-Json -Compress', cmd: ['tasklist.exe', ['/fo', 'csv', '/nh']] },
  services: { powershell: 'Get-Service | Select-Object -First 100 Name,Status,DisplayName | ConvertTo-Json -Compress', cmd: ['sc.exe', ['query', 'state=', 'all']] },
  network: { powershell: 'Get-NetIPConfiguration | Select-Object InterfaceAlias,IPv4Address,IPv6Address | ConvertTo-Json -Compress', cmd: ['ipconfig.exe', ['/all']] },
});

const MUTATION_COMMANDS = Object.freeze({
  stop_process: { powershell: 'Stop-Process -Id {0} -Force', cmd: ['taskkill.exe', ['/pid', '{0}', '/f']] },
  stop_service: { powershell: 'Stop-Service -Name {0}', cmd: ['sc.exe', ['stop', '{0}']] },
});

const WINDOWS_NAME = /^[A-Za-z0-9._\\-]{1,128}$/;
const WINDOWS_PID = /^\d{1,10}$/;

function requireIdentity(context = {}) {
  if (!context.userId || typeof context.userId !== 'string') throw new Error('Windows command execution requires an authenticated userId');
  if (!context.tenantId || typeof context.tenantId !== 'string') throw new Error('Windows command execution requires tenantId');
  return {
    userId: context.userId,
    tenantId: context.tenantId,
    domain: context.domain || 'generic',
    siteId: context.siteId || null,
    role: context.role || 'viewer',
  };
}

function requireApproval(context, mutation) {
  if (!mutation) return;
  if (context.approval?.approved !== true) throw new Error('Windows mutation requires explicit approval');
  if (context.approval.userId && context.approval.userId !== context.userId) throw new Error('Approval identity does not match executing user');
}

function validateArgument(command, value) {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid argument for ${command}`);
  if (command === 'stop_process' && !WINDOWS_PID.test(value)) throw new Error('Process ID must be numeric');
  if (command === 'stop_service' && !WINDOWS_NAME.test(value)) throw new Error('Service name contains unsafe characters');
  return value;
}

function auditEvent(action, context, command, argument) {
  return { action, command, argument: argument || null, ...requireIdentity(context), at: new Date().toISOString() };
}

export class WindowsShellAdapter {
  constructor({ shell, executor = execFileAsync, auditSink = () => {} } = {}) {
    if (!['powershell', 'cmd'].includes(shell)) throw new Error('shell must be powershell or cmd');
    this.shell = shell;
    this.executor = executor;
    this.auditSink = auditSink;
  }

  async execute(command, args = [], context = {}) {
    const identity = requireIdentity(context);
    const mutation = Object.hasOwn(MUTATION_COMMANDS, command);
    const spec = (mutation ? MUTATION_COMMANDS : READ_COMMANDS)[command];
    if (!spec) throw new Error(`Unsupported Windows command: ${command}`);
    requireApproval(context, mutation);
    if (!Array.isArray(args) || args.length > 1 || (mutation && args.length !== 1) || (!mutation && args.length !== 0)) {
      throw new Error(mutation ? 'Windows mutation requires exactly one validated argument' : 'Windows read commands accept zero arguments');
    }
    const argument = mutation ? validateArgument(command, args[0]) : undefined;
    const event = auditEvent(`windows.${this.shell}.${mutation ? 'mutate' : 'read'}`, context, command, argument);
    this.auditSink(event);

    let executable;
    let executableArgs;
    if (this.shell === 'powershell') {
      const script = argument ? spec.powershell.replace('{0}', argument.replaceAll("'", "''")) : spec.powershell;
      executable = 'powershell.exe';
      executableArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-Command', script];
    } else {
      executable = spec.cmd[0];
      executableArgs = spec.cmd[1].map((value) => value === '{0}' ? argument : value);
    }
    const result = await this.executor(executable, executableArgs, { shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return { ...result, audit: event, shell: this.shell, command };
  }
}

export class PowerShellAdapter extends WindowsShellAdapter {
  constructor(options = {}) { super({ ...options, shell: 'powershell' }); }
}

export class CmdAdapter extends WindowsShellAdapter {
  constructor(options = {}) { super({ ...options, shell: 'cmd' }); }
}

export { READ_COMMANDS, MUTATION_COMMANDS, requireIdentity, validateArgument };
