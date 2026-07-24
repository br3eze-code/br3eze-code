import { ToolRegistry } from './tool-registry.js';
import { AuthEngine } from './auth.js';
import { ApprovalEngine } from './approval.js';
import { AuditLogger } from './audit.js';
import AskEngine from './ask-engine.js';
import { logger } from '../utils/logger.js';

// src/core/agent.js


class Agent {
  constructor(config, db, workspace) {
    this.config = config
    this.db = db
    this.workspace = workspace

    this.audit = new AuditLogger(db, config.AUDIT_SECRET)
    this.approvals = new ApprovalEngine({ db, agent: this })
    this.auth = new AuthEngine({ db, approvals: this.approvals, workspace })
    this.registry = new ToolRegistry({ db, auth: this.auth, audit: this.audit })
    this.ask = new AskEngine({ registry: this.registry, config })
  }

  async init() {
    await this.registry.loadSkills(this.config.skills, this.workspace)
    logger.info(`AgentOS ready: ${this.registry.tools.size} tools from ${this.registry.drivers.size} skills`)
  }

  async run(prompt, userId) {
    const stream = this.ask.stream(prompt, userId)
    return stream // async generator: {type: 'delta'|'tool'|'approval'|...}
  }

  async executeTool(toolName, args, userId) {
    return this.registry.execute(toolName, args, userId)
  }

  // For approvals to send messages back
  async notify(userId, payload) {
    // Override this in gateway.js with Telegram/WS implementation
    logger.info(`Notify ${userId}:`, payload)
  }
}

export { Agent };
