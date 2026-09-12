export class GuardrailViolation extends Error {
  constructor(message, { stage = 'unknown', code = 'GUARDRAIL_BLOCKED', details = null } = {}) {
    super(message); this.name = 'GuardrailViolation'; this.code = code; this.stage = stage; this.details = details;
  }
}

export class GuardrailPipeline {
  constructor({ input = [], tool = [], output = [] } = {}) {
    this.rules = { input: [...input], tool: [...tool], output: [...output] };
  }
  add(stage, rule) { if (!this.rules[stage] || typeof rule !== 'function') throw new TypeError('Invalid guardrail stage/rule'); this.rules[stage].push(rule); return this; }
  async check(stage, value, context = {}) {
    for (const rule of this.rules[stage] || []) {
      const result = await rule(value, context);
      if (result === false) throw new GuardrailViolation(`${stage} guardrail blocked execution`, { stage });
      if (result && typeof result === 'object' && result.allowed === false) throw new GuardrailViolation(result.reason || `${stage} guardrail blocked execution`, { stage, details: result });
    }
    return value;
  }
  async input(value, context) { return this.check('input', value, context); }
  async tool(value, context) { return this.check('tool', value, context); }
  async output(value, context) { return this.check('output', value, context); }
}

export default GuardrailPipeline;
