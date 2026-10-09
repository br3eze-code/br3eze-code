import { randomUUID } from 'node:crypto';

export class EvaluationSuite {
  constructor({ evaluators = [], sink = null } = {}) {
    this.evaluators = new Map(evaluators.map((e) => [e.id, e]));
    this.sink = sink;
  }

  register(evaluator) {
    if (!evaluator?.id || typeof evaluator.evaluate !== 'function') throw new TypeError('evaluator requires id and evaluate()');
    this.evaluators.set(evaluator.id, evaluator);
    return this;
  }

  async run({ execution, expected = null, evaluators = null, metadata = {} } = {}) {
    const selected = evaluators || [...this.evaluators.keys()];
    const results = [];
    for (const id of selected) {
      const evaluator = this.evaluators.get(id);
      if (!evaluator) continue;
      const startedAt = Date.now();
      try {
        const value = await evaluator.evaluate({ execution, expected, metadata });
        results.push({ id, ok: true, score: value?.score ?? null, result: value, durationMs: Date.now() - startedAt });
      } catch (error) {
        results.push({ id, ok: false, score: 0, error: { name: error.name, message: error.message }, durationMs: Date.now() - startedAt });
      }
    }
    const scores = results.filter((r) => Number.isFinite(r.score)).map((r) => r.score);
    const score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const report = { evaluationId: randomUUID(), executionId: execution?.executionId || null, score, passed: results.every((r) => r.ok && (r.score == null || r.score >= 0.5)), results, createdAt: new Date().toISOString() };
    if (this.sink) await this.sink(report);
    return report;
  }
}

export function createBasicEvaluators() {
  return [
    { id: 'execution.completed', evaluate: ({ execution }) => ({ score: execution?.status === 'completed' ? 1 : 0 }) },
    { id: 'output.present', evaluate: ({ execution }) => ({ score: execution?.output == null ? 0 : 1 }) },
    { id: 'tenant.scoped', evaluate: ({ execution }) => ({ score: execution?.tenantId && execution?.userId ? 1 : 0 }) },
  ];
}

export default EvaluationSuite;
