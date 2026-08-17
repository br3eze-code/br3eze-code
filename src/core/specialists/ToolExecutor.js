import { createHash } from 'node:crypto';

function validateSchema(value, schema = {}, path = '$') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`];
    for (const field of schema.required || []) if (!(field in value)) errors.push(`${path}.${field} is required`);
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validateSchema(value[key], child, `${path}.${key}`));
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, `${path}[${index}]`)));
  } else if (schema.type === 'string' && typeof value !== 'string') errors.push(`${path} must be a string`);
  else if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) errors.push(`${path} must be a number`);
  else if (schema.type === 'integer' && !Number.isInteger(value)) errors.push(`${path} must be an integer`);
  else if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
  if (schema.maximum !== undefined && typeof value === 'number' && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  return errors;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function evidenceFrom(args, output) {
  const refs = [
    ...(Array.isArray(args?.evidenceRefs) ? args.evidenceRefs : []),
    ...(Array.isArray(output?.evidence) ? output.evidence : []),
    ...(Array.isArray(output?.evidenceRefs) ? output.evidenceRefs : []),
  ];
  return [...new Set(refs.filter((ref) => typeof ref === 'string' && ref.length > 0))];
}

function structuredResult({ tool, executionId, status, output = null, error = null, evidence = [], warnings = [] }) {
  return {
    success: status === 'success' || status === 'replayed',
    tool,
    executionId,
    ...(status === 'success' || status === 'replayed' ? { data: output } : {}),
    ...(error ? { error: { code: error.code || 'TOOL_EXECUTION_FAILED', message: error.message || String(error) } } : {}),
    evidence,
    warnings,
  };
}

export class ToolExecutor {
  constructor({ policy, clock = () => new Date(), idFactory = () => `exec_${Date.now()}_${Math.random().toString(16).slice(2)}`, executionStore = null, idempotencyStore = null } = {}) {
    this.policy = policy;
    this.clock = clock;
    this.idFactory = idFactory;
    this.executionStore = executionStore;
    this.idempotencyStore = idempotencyStore || new Map();
  }

  async execute({ specialist, tool, args = {}, context = {}, ticketType = null, correlationId = null, taskId = null } = {}) {
    const started = this.clock();
    const executionId = this.idFactory();
    const inputHash = stableHash(args);
    const idempotencyKey = args?.idempotencyKey;
    const replayKey = idempotencyKey && context.tenantId && context.userId
      ? `${context.tenantId}:${context.userId}:${tool.name}:${idempotencyKey}`
      : null;
    const record = {
      executionId,
      specialist: specialist.id || specialist.role,
      skill: tool.skill || null,
      tool: tool.name,
      ticketId: taskId || context.taskId || context.ticketId || null,
      actor: context.userId || null,
      tenant: context.tenantId || null,
      inputHash,
      input: args,
      output: null,
      result: null,
      evidence: [],
      warnings: [],
      status: 'failed',
      timestamp: started.toISOString(),
      durationMs: null,
      correlationId: correlationId || context.correlationId || null,
    };

    try {
      this.policy.authorize({ specialist, tool, context, ticketType });
      if (replayKey && this.idempotencyStore.has(replayKey)) {
        const previous = this.idempotencyStore.get(replayKey);
        record.status = 'replayed';
        record.replayOf = previous.executionId;
        record.output = previous.output;
        record.evidence = [...(previous.evidence || [])];
        record.warnings = [...(previous.warnings || [])];
        record.result = structuredResult({ tool: tool.name, executionId, status: 'replayed', output: record.output, evidence: record.evidence, warnings: record.warnings });
        record.durationMs = 0;
        return this._persist(record);
      }
      const inputErrors = validateSchema(args, tool.inputSchema || tool.parameters);
      if (inputErrors.length) throw Object.assign(new Error(`Input validation failed: ${inputErrors.join('; ')}`), { code: 'INPUT_VALIDATION_FAILED' });
      const output = await tool.handler(args, context);
      const outputErrors = tool.outputSchema ? validateSchema(output, tool.outputSchema, '$output') : [];
      if (outputErrors.length) throw Object.assign(new Error(`Output validation failed: ${outputErrors.join('; ')}`), { code: 'OUTPUT_VALIDATION_FAILED' });
      record.output = output;
      record.evidence = evidenceFrom(args, output);
      record.result = structuredResult({ tool: tool.name, executionId, status: 'success', output, evidence: record.evidence, warnings: output?.warnings || [] });
      record.status = 'success';
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      record.errorCode = error?.code || 'TOOL_EXECUTION_FAILED';
      record.result = structuredResult({ tool: tool.name, executionId, status: 'failed', error: { code: record.errorCode, message: record.error }, evidence: record.evidence, warnings: record.warnings });
    }

    record.durationMs = Math.max(0, this.clock().getTime() - started.getTime());
    const persisted = this._persist(record);
    if (replayKey && persisted.status === 'success' && persisted.output?.status !== 'approval_required') this.idempotencyStore.set(replayKey, persisted);
    return persisted;
  }

  _persist(record) {
    const immutable = Object.freeze({ ...record, evidence: Object.freeze([...(record.evidence || [])]), warnings: Object.freeze([...(record.warnings || [])]) });
    if (this.executionStore?.append) this.executionStore.append(immutable);
    return immutable;
  }
}

export { canonicalize, evidenceFrom, stableHash, structuredResult, validateSchema };
export default ToolExecutor;
