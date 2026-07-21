import BaseDomain from '../BaseDomain.js';
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

class LinuxDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'linux';

    this.registerTool({
      name: 'shell',
      description: 'Execute a shell command',
      execute: async (command) => {
        try {
          const { stdout, stderr } = await execAsync(command);
          return stdout || stderr;
        } catch (err) {
          return `Error: ${err.message}`;
        }
      }
    });

    this.registerTool({
      name: 'uptime',
      description: 'Get system uptime',
      execute: async () => {
        const { stdout } = await execAsync('uptime -p');
        return stdout.trim();
      }
    });
  }
}

export default LinuxDomain;
