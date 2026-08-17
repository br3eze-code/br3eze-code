import { createHash, randomUUID } from 'node:crypto';
import defaultEventBus from '../eventBus.js';
import { ToolRegistry } from '../ToolRegistry.js';
import { ApprovalGate } from '../approval-gate.js';
import { HandoffManager } from '../handoff-manager.js';
import { INVENTORY_SPECIALIST, createInventorySpecialist } from './inventory-specialist.js';
import { InventoryBusinessError } from './inventory-adapter.js';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashInput(input) {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

function freezeRecord(record) {
  return Object.freeze({
    ...record,
    input: Object.freeze({ ...record.input }),
    output:
      record.output && typeof record.output === 'object'
        ? Object.freeze({ ...record.output })
        : record.output,
    error: record.error ? Object.freeze({ ...record.error }) : undefined,
    evidence: Object.freeze([...(record.evidence || [])]),
    warnings: Object.freeze([...(record.warnings || [])]),
  });
}

export class InventorySpecialistRuntime {
  constructor({
    adapter,
    eventBus = defaultEventBus,
    registry = new ToolRegistry(),
    approvalGate = new ApprovalGate(),
    handoffManager = new HandoffManager(),
  } = {}) {
    this.specialist = createInventorySpecialist({ adapter });
    this.eventBus = eventBus;
    this.registry = registry;
    this.approvalGate = approvalGate;
    this.handoffManager = handoffManager;
    this.executionRecords = [];

    this.registry.registerDomain('inventory', this.specialist.toolDefinitions);
  }

  getSpecialist() {
    return { ...this.specialist, toolDefinitions: undefined };
  }

  listTools() {
    return this.specialist.tools.map(name => this.registry.getTool(name));
  }

  createHandoff(input) {
    return this.handoffManager.create(input);
  }

  getHandoff(handoffId) {
    return this.handoffManager.get(handoffId);
  }

  executeTask({ tool, input }, context = {}) {
    return this.execute(tool, input, context);
  }

  async execute(toolName, input, context = {}) {
    const startedAt = Date.now();
    const executionId = `exe_${randomUUID()}`;
    const correlationId = context.correlationId || `corr_${randomUUID()}`;
    const base = {
      executionId,
      specialist: this.specialist.id,
      specialistId: this.specialist.id,
      skillId: context.skillId || this.specialist.skills[0],
      tool: toolName,
      toolId: toolName,
      taskId: context.taskId || context.ticketId || null,
      actor: context.actor || context.actorId || context.userId || null,
      tenant: context.tenant || context.tenantId || null,
      input: input && typeof input === 'object' ? input : {},
      inputHash: hashInput(input && typeof input === 'object' ? input : {}),
      correlationId,
      approvalId: context.approval?.approvalId || null,
      timestamp: new Date().toISOString(),
    };

    if (!this.specialist.tools.includes(toolName)) {
      return this.#recordFailure(
        base,
        'UNKNOWN_TOOL',
        `Tool is not available to ${this.specialist.id}: ${toolName}`,
        {},
        null,
        startedAt
      );
    }

    const registeredTool = this.registry.getTool(toolName);
    const requiredPermissions = registeredTool.permissions || [];
    const specialistPermissions = new Set(this.specialist.permissions);
    const callerPermissions = new Set(context.permissions || []);
    const missingSpecialistPermission = requiredPermissions.find(
      permission => !specialistPermissions.has(permission)
    );
    const missingCallerPermission = requiredPermissions.find(
      permission => !callerPermissions.has(permission)
    );
    if (missingSpecialistPermission || missingCallerPermission) {
      return this.#recordFailure(
        base,
        'PERMISSION_DENIED',
        `Permission denied for ${toolName}`,
        {
          required: requiredPermissions,
          missing: missingSpecialistPermission || missingCallerPermission,
        },
        registeredTool,
        startedAt
      );
    }

    const approval = this.approvalGate.inspect({ tool: toolName, context, metadata: registeredTool });
    if (!approval.allowed) {
      return this.#recordFailure(
        base,
        approval.code,
        approval.message || 'Approval is required before this tool can execute',
        { approval: approval.request || { approvalId: context.approval?.approvalId || null } },
        registeredTool,
        startedAt
      );
    }

    const parsedInput = registeredTool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return this.#recordFailure(
        base,
        'VALIDATION_ERROR',
        'Tool input failed schema validation',
        { issues: parsedInput.error.issues },
        registeredTool,
        startedAt
      );
    }

    try {
      const rawOutput = await this.registry.execute(toolName, parsedInput.data, context);
      const parsedOutput = registeredTool.outputSchema.safeParse(rawOutput);
      if (!parsedOutput.success) {
        return this.#recordFailure(
          base,
          'OUTPUT_VALIDATION_ERROR',
          'Tool output failed schema validation',
          { issues: parsedOutput.error.issues },
          registeredTool,
          startedAt
        );
      }

      const record = await this.#buildRecord(
        base,
        { status: 'success', output: parsedOutput.data },
        registeredTool,
        startedAt
      );
      this.executionRecords.push(record);
      this.eventBus.emit('specialist.tool.executed', record);
      return {
        success: true,
        tool: toolName,
        executionId,
        data: parsedOutput.data,
        evidence: record.evidence,
        warnings: record.warnings,
        execution: record,
      };
    } catch (error) {
      if (error instanceof InventoryBusinessError) {
        return this.#recordFailure(base, error.code, error.message, error.details, registeredTool, startedAt);
      }
      return this.#recordFailure(
        base,
        'TOOL_ERROR',
        error.message || 'Tool execution failed',
        {},
        registeredTool,
        startedAt
      );
    }
  }

  getExecutionRecords() {
    return [...this.executionRecords];
  }

  async #recordFailure(base, code, message, details, registeredTool, startedAt) {
    const record = await this.#buildRecord(
      base,
      { status: 'error', error: { code, message, details } },
      registeredTool,
      startedAt
    );
    this.executionRecords.push(record);
    this.eventBus.emit('specialist.tool.failed', record);
    return {
      success: false,
      tool: base.tool,
      executionId: base.executionId,
      error: record.error,
      evidence: record.evidence,
      warnings: record.warnings,
      execution: record,
    };
  }

  async #buildRecord(base, outcome, registeredTool, startedAt) {
    const draft = {
      ...base,
      ...outcome,
      durationMs: Math.max(0, Date.now() - startedAt),
      evidence: [],
      warnings: [],
    };
    if (registeredTool && typeof registeredTool.audit === 'function') {
      try {
        const auditEvidence = await registeredTool.audit({ ...draft });
        if (auditEvidence !== undefined && auditEvidence !== null) draft.evidence.push(auditEvidence);
      } catch (error) {
        draft.warnings.push({
          code: 'AUDIT_HOOK_FAILED',
          message: error.message || 'Audit hook failed',
        });
      }
    }
    return freezeRecord(draft);
  }
}

export { INVENTORY_SPECIALIST, hashInput };
