import { Client } from 'ssh2';
import { BaseSkill } from './base.js';
import { buildServiceCommand, detectionCommand } from '../core/platform/service-manager.js';

const SERVICE_NAME = /^[A-Za-z0-9_.:@/-]{1,128}$/;
const SINCE = /^[0-9]+[mhd]$/;

function requireIdentity(ctx = {}) {
  const identity = ctx.identity || {};
  const userId = ctx.userId || identity.userId || identity.id;
  if (!userId) throw new Error('Linux skill execution requires an authenticated user context');
  return { ...ctx, userId, tenantId: ctx.tenantId || identity.tenantId || null };
}

function requireServiceName(value) {
  if (typeof value !== 'string' || !SERVICE_NAME.test(value)) throw new Error('Invalid service name');
  return value;
}

function requireSince(value = '1h') {
  if (!SINCE.test(value)) throw new Error('Invalid log window');
  return value;
}

function requirePid(value) {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid < 1 || pid > 4194304) throw new Error('Invalid process id');
  return pid;
}

class LinuxSkill extends BaseSkill {
  static id = 'linux'
  static name = 'Linux Server'

  constructor(config, logger, workspace) {
    super(config, logger, workspace)
  }

  static getTools() {
    return {
      'lin.system.info': {
        risk: 'low',
        description: 'Get distro, kernel, uptime, load, memory, disk',
        parameters: {
          type: 'object',
          properties: { host: { type: 'string', description: 'hostId from workspace' } },
          required: ['host']
        }
      },
      'lin.service.status': {
        risk: 'low',
        description: 'Check systemd service status',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            name: { type: 'string', description: 'service name like nginx' }
          },
          required: ['host', 'name']
        }
      },
      'lin.service.restart': {
        risk: 'medium',
        description: 'Restart systemd service. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            name: { type: 'string' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['host', 'name', 'reason']
        }
      },
      'lin.process.list': {
        risk: 'low',
        description: 'Top processes by CPU or memory',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            sort: { type: 'string', enum: ['cpu', 'mem'], default: 'cpu' },
            top: { type: 'number', default: 10, maximum: 50 }
          },
          required: ['host']
        }
      },
      'lin.process.kill': {
        risk: 'high',
        description: 'Kill process by PID. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            pid: { type: 'number' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['host', 'pid', 'reason']
        }
      },
      'lin.logs.journal': {
        risk: 'low',
        description: 'Query journalctl logs',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            unit: { type: 'string', description: 'systemd unit like nginx.service' },
            since: { type: 'string', default: '1h', pattern: '^[0-9]+[mhd]$' },
            priority: { type: 'string', enum: ['emerg', 'alert', 'crit', 'err', 'warning'], default: 'err' }
          },
          required: ['host']
        }
      },
      'lin.pkg.outdated': {
        risk: 'low',
        description: 'List outdated packages. Auto-detects apt/yum/dnf',
        parameters: {
          type: 'object',
          properties: { host: { type: 'string' } },
          required: ['host']
        }
      },
      'lin.system.reboot': {
        risk: 'high',
        description: 'Reboot Linux host. Requires approval.',
        parameters: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            reason: { type: 'string', maxLength: 200 }
          },
          required: ['host', 'reason']
        }
      }
    }
  }

  async _exec(hostId, cmd, sudo = false, rawCtx = {}) {
    const ctx = requireIdentity(rawCtx)
    const host = this.workspace.linux_hosts?.[hostId]
    if (!host || host.driver !== 'linux') throw new Error(`Linux host ${hostId} not found`)
    if (host.tenantId && host.tenantId !== ctx.tenantId) throw new Error('Linux host is outside the active tenant')
    if (Array.isArray(host.allowedUsers) && !host.allowedUsers.includes(ctx.userId)) {
      throw new Error('User is not authorized for this Linux host')
    }

    return new Promise((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        const finalCmd = sudo ? `sudo -n -- ${cmd}` : cmd
        conn.exec(finalCmd, { pty: false }, (err, stream) => {
          if (err) return reject(err)
          let out = '', errOut = ''
          stream.on('data', d => out += d)
          stream.stderr.on('data', d => errOut += d)
          stream.on('close', code => {
            conn.end()
            if (code!== 0) reject(new Error(errOut || `Exit ${code}`))
            else resolve(out.trim())
          })
        })
      }).on('error', reject).connect({
        host: host.hostname,
        port: host.port || 22,
        username: host.username || this.config.user,
        privateKey: host.privateKey || this.config.privateKey,
        password: host.password || this.config.password,
        readyTimeout: 10000
      })
    })
  }

  async _serviceManager(hostId, ctx) {
    const detected = await this._exec(hostId, detectionCommand('linux'), false, ctx);
    const manager = ['systemd', 'openrc', 'sysvinit'].find((name) => detected.includes(name));
    if (!manager) throw new Error('No supported service manager found');
    return manager;
  }

  async healthCheck() {

    const firstHost = Object.keys(this.workspace.linux_hosts || {})[0]
    if (!firstHost) return { status: 'ok', note: 'no Linux hosts configured' }
    await this._exec(firstHost, 'uptime', false, { userId: 'system', tenantId: this.workspace?.tenantId })
    return { status: 'ok' }
  }

  async execute(toolName, args = {}, ctx = {}) {
    const identityContext = requireIdentity(ctx)
    try {
      switch (toolName) {
        case 'lin.system.info':
          const info = await this._exec(args.host, `
            echo "{"
            echo "\\"distro\\": \\"$(. /etc/os-release && echo $PRETTY_NAME)\\","
            echo "\\"kernel\\": \\"$(uname -r)\\","
            echo "\\"uptime\\": \\"$(uptime -p)\\","
            echo "\\"load\\": \\"$(cat /proc/loadavg | awk '{print $1,$2,$3}')\\","
            echo "\\"memory\\":"
            free -h | awk '/Mem:/ {print "{\\"total\\":\\""$2"\\", \\"used\\":\\""$3"\\", \\"free\\":\\""$4"\\"}"}',"
            echo "\\"disk\\":"
            df -h / | tail -1 | awk '{print "{\\"used\\":\\""$3"\\", \\"avail\\":\\""$4"\\", \\"pct\\":\\""$5"\\"}" }'
            echo "}"
          `, false, identityContext)
          return JSON.parse(info)

        case 'lin.service.status': {
          const name = requireServiceName(args.name);
          const manager = await this._serviceManager(args.host, identityContext);
          return await this._exec(args.host, buildServiceCommand('status', manager, name), false, identityContext);
        }

        case 'lin.service.restart': {
          const name = requireServiceName(args.name);
          if (identityContext.approval?.status !== 'approved') throw new Error('Service restart requires an approved action');
          const manager = await this._serviceManager(args.host, identityContext);
          this.logger.warn(`LINUX SERVICE RESTART ${args.host}`, { user: identityContext.userId, tenant: identityContext.tenantId, service: name, reason: args.reason });
          return await this._exec(args.host, buildServiceCommand('restart', manager, name), true, identityContext);
        }

        case 'lin.process.list':
          const sort = args.sort === 'mem'? '--sort=-%mem' : '--sort=-%cpu'
          const top = Math.min(50, Math.max(1, Number.isInteger(args.top) ? args.top : 10));
          const ps = await this._exec(args.host, `ps -eo pid,user,%cpu,%mem,comm ${sort} | head -n ${top + 1}`, false, identityContext)
          return ps.split('\n').slice(1).map(l => {
            const p = l.trim().split(/\s+/)
            return { pid: +p[0], user: p[1], cpu: +p[2], mem: +p[3], command: p.slice(4).join(' ') }
          })

        case 'lin.process.kill':
          const pid = requirePid(args.pid);
          if (identityContext.approval?.status !== 'approved') throw new Error('Process termination requires an approved action');
          this.logger.warn(`LINUX KILL PID ${pid} on ${args.host}`, { user: identityContext.userId, tenant: identityContext.tenantId, reason: args.reason })
          return await this._exec(args.host, `kill -9 ${pid}`, true, identityContext)

        case 'lin.logs.journal': {
          const unit = requireServiceName(args.unit || 'system');
          const since = requireSince(args.since || '1h');
          const manager = await this._serviceManager(args.host, identityContext);
          return await this._exec(args.host, buildServiceCommand('logs', manager, unit, since), false, identityContext);
        }

        case 'lin.pkg.outdated':
          // Auto-detect package manager
          const pm = await this._exec(args.host, `command -v apt >/dev/null && printf apt || command -v dnf >/dev/null && printf dnf || command -v yum >/dev/null && printf yum`, false, identityContext)
          if (pm === 'apt') return await this._exec(args.host, `apt list --upgradable 2>/dev/null | tail -n +2`, false, identityContext)
          if (pm === 'dnf') return await this._exec(args.host, `dnf check-update -q || true`, false, identityContext)
          if (pm === 'yum') return await this._exec(args.host, `yum check-update -q || true`, false, identityContext)
          throw new Error('No supported package manager found')

        case 'lin.system.reboot':
          if (identityContext.approval?.status !== 'approved') throw new Error('Host reboot requires an approved action');
          this.logger.warn(`LINUX REBOOT ${args.host}`, { user: identityContext.userId, tenant: identityContext.tenantId, reason: args.reason })
          return await this._exec(args.host, 'reboot', true, identityContext)

        default:
          throw new Error(`Unknown tool ${toolName}`)
      }
    } catch (e) {
      this.logger.error(`Linux ${toolName} failed: ${e.message}`)
      throw e
    }
  }
}

export default LinuxSkill;
