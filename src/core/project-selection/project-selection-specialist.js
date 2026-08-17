import { ProjectSelectionEngine } from './selection-engine.js';

export class ProjectSelectionSpecialist {
  constructor({ engine = new ProjectSelectionEngine(), handoff = null, factsAdapter = null } = {}) {
    this.engine = engine;
    this.handoff = handoff;
    this.factsAdapter = factsAdapter;
    this.specialistId = 'project-selection';
    this.skillId = 'project-selection';
  }

  async evaluateFromCanonicalFacts(projectId, context = {}) {
    if (!this.factsAdapter) throw Object.assign(new Error('Project facts adapter is not configured'), { code: 'FACTS_ADAPTER_NOT_CONFIGURED' });
    const project = await this.factsAdapter.getProjectFacts(projectId, context.tenantId);
    return this.evaluate(project, context);
  }

  evaluate(project, context = {}) {
    const evaluation = this.engine.evaluate(project);
    return Object.freeze({ specialistId: this.specialistId, skillId: this.skillId, tenantId: context.tenantId, taskId: context.taskId || null, evaluation });
  }

  async recommend(project, context = {}) {
    const result = this.evaluate(project, context);
    if (['REJECT', 'HOLD', 'REVIEW'].includes(result.evaluation.decision.status) && this.handoff) await this.handoff({ from: this.specialistId, to: 'project-manager', action: 'project-selection.review', tenantId: context.tenantId, taskId: context.taskId || null, evidence: result.evaluation });
    return result;
  }
}
