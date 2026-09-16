export class StructuredOutputError extends Error {
  constructor(message, { issues = [] } = {}) { super(message); this.name = 'StructuredOutputError'; this.issues = issues; }
}

export function validateStructuredOutput(value, schema, { path = '$' } = {}) {
  const issues = [];
  const visit = (v, s, p) => {
    if (!s) return;
    if (s.type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) { issues.push(`${p} must be an object`); return; }
      for (const key of s.required || []) if (!(key in v)) issues.push(`${p}.${key} is required`);
      for (const [key, child] of Object.entries(s.properties || {})) if (key in v) visit(v[key], child, `${p}.${key}`);
    } else if (s.type === 'array') {
      if (!Array.isArray(v)) { issues.push(`${p} must be an array`); return; }
      if (s.maxItems != null && v.length > s.maxItems) issues.push(`${p} exceeds maxItems`);
      if (s.items) v.forEach((item, i) => visit(item, s.items, `${p}[${i}]`));
    } else if (s.type && typeof v !== s.type) issues.push(`${p} must be ${s.type}`);
    if (s.enum && !s.enum.includes(v)) issues.push(`${p} is not an allowed value`);
    if (s.pattern && typeof v === 'string' && !(new RegExp(s.pattern)).test(v)) issues.push(`${p} does not match pattern`);
  };
  visit(value, schema, path);
  if (issues.length) throw new StructuredOutputError('Structured output validation failed', { issues });
  return value;
}

export default validateStructuredOutput;
