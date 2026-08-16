import BaseDomain from '../BaseDomain.js';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

function normalizeContext(context = {}) {
  const identity = context.identity || {};
  return {
    userId: context.userId || identity.userId || identity.id || null,
    tenantId: context.tenantId || identity.tenantId || null,
    approval: context.approval || null
  };
}

function assertIdentity(context, { mutation = false } = {}) {
  const identity = normalizeContext(context);
  if (!identity.userId) throw new Error('Linux tool execution requires an authenticated user context.');
  if (mutation && identity.approval?.status !== 'approved') {
    throw new Error('Linux mutation requires an approved action.');
  }
  return identity;
}

class LinuxDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'linux';
    this.description = 'Domain-neutral local host diagnostics and controlled operations';
    this.capabilities = ['host.diagnostics', 'host.command'];

    this.registerTool({
      name: 'shell',
      description: 'Execute an explicitly approved shell command in the current host context',
      risk: 'high',
      passContext: true,
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', minLength: 1, maxLength: 4096 } },
        required: ['command'],
        additionalProperties: false
      },
      execute: async (command, context) => {
        assertIdentity(context, { mutation: true });
        if (typeof command !== 'string' || command.trim().length === 0 || command.length > 4096) {
          throw new Error('A non-empty shell command up to 4096 characters is required.');
        }
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: context?.workspace?.cwd || process.cwd(),
            env: { ...process.env, AGENTOS_ACTOR_ID: normalizeContext(context).userId },
            maxBuffer: 1024 * 1024,
            timeout: 30_000
          });
          return stdout || stderr;
        } catch (err) {
          return `Error: ${err.message}`;
        }
      }
    });

    this.registerTool({
      name: 'uptime',
      description: 'Get system uptime',
      risk: 'low',
      passContext: true,
      execute: async (context) => {
        assertIdentity(context);
        const { stdout } = await execAsync('uptime -p', { timeout: 10_000, maxBuffer: 64 * 1024 });
        return stdout.trim();
      }
    });
  }
}

export default LinuxDomain;