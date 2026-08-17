import { createSpecialistContext } from './SpecialistContext.js';
import { specialistResult } from './SpecialistResult.js';
import ToolPolicy from './ToolPolicy.js';
import ToolExecutor from './ToolExecutor.js';
import { createHandoff } from './Handoff.js';

export class SpecialistRuntime {
  constructor({ specialistRegistry, toolRegistry, policy = new ToolPolicy(), executor = null, executionStore = null, clock, idFactory } = {}) {
    if (!specialistRegistry || !toolRegistry) throw new Error('specialistRegistry and toolRegistry are required');
    this.specialistRegistry = specialistRegistry;
    this.toolRegistry = toolRegistry;
    this.executor = executor || new ToolExecutor({ policy, executionStore, clock, idFactory });
  }

  createHandoff(specialistRef, { to, workPackageId, requestedAction, context = {}, evidence = [], acceptanceCriteria = [], payload = {}, riskLevel = 'medium', requiresApproval = false } = {}) {
    const source = this.specialistRegistry.get(specialistRef);
    if (!source) throw new Error(`Specialist not found: ${specialistRef}`);
    const target = this.specialistRegistry.get(to) || this.specialistRegistry.get(`${to}-specialist`);
    if (!target) throw new Error(`Target specialist not found: ${to}`);
    const allowedTargets = source.handoffsTo || source.handoffs || [];
    const targetRole = target.role || target.id.replace(/-specialist$/, '');
    if (allowedTargets.length && !allowedTargets.includes(targetRole) && !allowedTargets.includes(target.id)) throw new Error(`Specialist ${specialistRef} cannot hand off to ${to}`);
    return createHandoff({ from: source.role || source.id, to: targetRole, workPackageId, requestedAction, tenantId: context.tenantId, userId: context.userId, evidence, acceptanceCriteria, payload, riskLevel, requiresApproval });
  }

  async execute(specialistRef, { task = null, skill = null, tool = null, args = {}, context = {}, ticketType = null, correlationId = null } = {}) {
    const specialist = this.specialistRegistry.get(specialistRef);
    if (!specialist) return specialistResult({ status: 'failed', error: `Specialist not found: ${specialistRef}` });
    const executionContext = createSpecialistContext({ ...context, correlationId: correlationId || context.correlationId });
    if (!skill) return specialistResult({ status: 'failed', error: 'Skill is required' });
    const selectedSkill = this.toolRegistry.getSkill(skill);
    if (!selectedSkill) return specialistResult({ status: 'failed', error: `Skill not found: ${skill}` });
    const selectedTool = this.toolRegistry.getTool(tool) || null;
    if (!selectedTool) return specialistResult({ status: 'failed', error: `Tool not found: ${tool}` });
    if (selectedTool.skill !== selectedSkill.name) return specialistResult({ status: 'failed', error: `Tool ${tool} does not belong to skill ${skill}` });
    const ownedTools = this.toolRegistry.toolsForSpecialist(specialist);
    if (!ownedTools.some((candidate) => candidate.name === selectedTool.name)) return specialistResult({ status: 'failed', error: `Tool ${tool} is not owned by specialist ${specialist.id}` });
    if (task && ticketType && task.ticketType && task.ticketType !== ticketType) return specialistResult({ status: 'failed', error: 'Task ticket type does not match execution ticket type' });
    const execution = await this.executor.execute({ specialist, tool: selectedTool, args, context: executionContext, ticketType: ticketType || task?.ticketType || null, taskId: task?.taskId || context.taskId || context.ticketId || null, correlationId: executionContext.correlationId });
    return specialistResult({ status: execution.status, output: execution.output, execution, error: execution.error || null });
  }
}

export default SpecialistRuntime;
