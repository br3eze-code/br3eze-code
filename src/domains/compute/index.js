import os from 'node:os';
import BaseDomain from '../BaseDomain.js';

class ComputeDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'compute';
    this.registerTool({
      name: 'stats',
      description: 'Get CPU and memory utilization statistics',
      execute: async () => {
        const memory = process.memoryUsage();
        const [load1] = os.loadavg();
        const cpuCount = Math.max(1, os.cpus().length);
        const cpu = Math.min(100, Math.max(0, (load1 / cpuCount) * 100));
        return {
          cpu: `${cpu.toFixed(1)}%`,
          loadAverage: Number(load1.toFixed(2)),
          memory: {
            heapUsed: `${Math.floor(memory.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.floor(memory.heapTotal / 1024 / 1024)}MB`,
            rss: `${Math.floor(memory.rss / 1024 / 1024)}MB`,
          },
          uptime: process.uptime(),
          cpuCount,
        };
      },
    });
    this.registerTool({
      name: 'processes',
      description: 'Get AgentOS runtime process information',
      execute: async () => [{
        pid: process.pid,
        status: 'running',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      }],
    });
  }
}

export default ComputeDomain;
