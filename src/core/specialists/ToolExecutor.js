function validateSchema(value, schema = {}, path = '$') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} must be an object`];
    for (const field of schema.required || []) if (!(field in value)) errors.push(`${path}.${field} is required`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) errors.push(...validateSchema(value[key], child, `${path}.${key}`));
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, `${path}[${index}]`)));
  } else if (schema.type === 'string' && typeof value !== 'string') errors.push(`${path} must be a string`);
  else if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) errors.push(`${path} must be a number`);
  else if (schema.type === 'integer' && (!Number.isInteger(value))) errors.push(`${path} must be an integer`);
  else if (schema.type === 'boolean' && typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
  return errors;
}

export class ToolExecutor {
  constructor({ policy, clock = () => new Date(), idFactory = () => `exec_${Date.now()}_${Math.random().toString(16).slice(2)}`, executionStore = null } = {}) {
    this.policy = policy;
    this.clock = clock;
    this.idFactory = idFactory;
    this.executionStore = executionStore;
  }

  async execute({ specialist, tool, args = {}, context = {}, ticketType = null, correlationId = null } = {}) {
    const startedAt = this.clock().toISOString();
    const record = {
      executionId: this.idFactory(),
      specialist: specialist.id || specialist.role,
      tool: tool.name,
      input: args,
      output: null,
      status: 'failed',
      timestamp: startedAt,
      correlationId: correlationId || context.correlationId || null,
    };
    try {
      this.policy.authorize({ specialist, tool, context, ticketType });
      const inputErrors = validateSchema(args, tool.parameters || tool.inputSchema);
      if (inputErrors.length) throw new Error(`Input validation failed: ${inputErrors.join('; ')}`);
      const output = await tool.handler(args, context);
      const outputErrors = tool.outputSchema ? validateSchema(output, tool.outputSchema, '$output') : [];
      if (outputErrors.length) throw new Error(`Output validation failed: ${outputErrors.join('; ')}`);
      record.output = output;
      record.status = 'success';
      return this._persist(record);
    } catch (error) {
      record.error = error instanceof Error ? error.message : String(error);
      return this._persist(record);
    }
  }

  _persist(record) {
    const immutable = Object.freeze({ ...record });
    if (this.executionStore?.append) this.executionStore.append(immutable);
    return immutable;
  }
}

export { validateSchema };
export default ToolExecutor;
