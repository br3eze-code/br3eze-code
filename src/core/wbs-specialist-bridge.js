import defaultEventBus from './eventBus.js';
import { getTaskRegistry } from './taskRegistry.js';
import { instantiateWorkPackages } from './wbs-work-packages.js';
import { SpecialistRegistry } from '../runtime/specialist-registry.js';
import { registerCommerceSpecialists } from '../runtime/commerce-specialists.js';

/**
 * WBS -> Specialist -> Skill -> Tool routing contract.
 *
 * WBS remains the durable work model. Specialists own capabilities, skills
 * describe the procedure, and tools perform side effects. Events create or
 * advance work; they never bypass authorization or the specialist runtime.
 */
export const WBS_SPECIALIST_MAP = Object.freeze({
  planner: { specialist: 'project-manager-specialist', skill: 'project-manager' },
  engineer: { specialist: 'br3eze-code-specialist', skill: 'br3eze-code' },
  accountant: { specialist: 'billing-specialist', skill: 'billing' },
  procurement: { specialist: 'procurement-specialist', skill: 'procurement' },
  expeditor: { specialist: 'fulfillment-specialist', skill: 'fulfillment' },
  designer: { specialist: 'designer-specialist', skill: 'designer' },
  draftsman: { specialist: 'designer-specialist', skill: 'designer' },
  qa: { specialist: 'project-manager-specialist', skill: 'project-manager' },
  catalog: { specialist: 'catalog-specialist', skill: 'catalog' },
  pricing: { specialist: 'pricing-specialist', skill: 'pricing' },
  inventory: { specialist: 'inventory-specialist', skill: 'inventory' },
  orders: { specialist: 'orders-specialist', skill: 'orders' },
  voucher: { specialist: 'voucher-specialist', skill: 'voucher' },
  fulfillment: { specialist: 'fulfillment-specialist', skill: 'fulfillment' },
  billing: { specialist: 'billing-specialist', skill: 'billing' },
  'project-manager': { specialist: 'project-manager-specialist', skill: 'project-manager' },
});

export const EVENT_TASK_MAP = Object.freeze({
  'voucher.created': { role: 'voucher', ticketType: 'voucher-issue', action: 'voucher.issue' },
  'voucher.redeemed': { role: 'voucher', ticketType: 'voucher-redemption', action: 'voucher.redeem' },
  'specialist.tool.executed': { role: null, ticketType: 'specialist-execution', action: 'specialist.tool.executed' },
  'specialist.tool.failed': { role: null, ticketType: 'specialist-failure', action: 'specialist.tool.failed' },
  'task:created': { role: null, ticketType: 'task-created', action: 'task.created' },
});

export function resolveSpecialistForWorkPackage(workPackage) {
  const role = String(workPackage?.agentRole || '').trim().toLowerCase();
  const mapping = WBS_SPECIALIST_MAP[role];
  if (!mapping) return null;
  return { ...mapping, wbsId: workPackage.wbsId, role };
}

export function decorateWorkPackage(workPackage) {
  const route = resolveSpecialistForWorkPackage(workPackage);
  if (!route) return { ...workPackage };
  return Object.freeze({
    ...workPackage,
    specialistId: route.specialist,
    skillId: route.skill,
    routing: Object.freeze({ specialistId: route.specialist, skillId: route.skill }),
  });
}

export function instantiateRoutedWorkPackages(role, context = {}, options = {}) {
  return instantiateWorkPackages(role, context, options).map(decorateWorkPackage);
}

export function resolveEventTask(eventName, payload = {}) {
  const definition = EVENT_TASK_MAP[eventName];
  if (!definition) return null;
  const role = definition.role || payload.specialistRole || payload.agentRole || null;
  const route = role ? WBS_SPECIALIST_MAP[role] : null;
  return {
    eventName,
    ticketType: definition.ticketType,
    action: definition.action,
    specialistId: route?.specialist || payload.specialistId || payload.specialist || null,
    skillId: route?.skill || payload.skillId || payload.skill || null,
  };
}

/**
 * Attach event-driven work creation to an EventEmitter-compatible bus.
 * Returns an unsubscribe function so tests/process shutdown can detach it.
 */
export function attachWbsEventTaskBridge({ eventBus = defaultEventBus, taskRegistry = getTaskRegistry() } = {}) {
  const handlers = [];
  for (const eventName of Object.keys(EVENT_TASK_MAP)) {
    const handler = (payload = {}) => {
      const route = resolveEventTask(eventName, payload);
      if (!route || !route.specialistId) return null;

      const tenantId = payload.tenantId || payload.tenant?.id || payload.context?.tenantId || null;
      const projectId = payload.projectId || payload.context?.projectId || null;
      const workId = payload.workId || payload.taskId || payload.executionId || `${eventName}:${Date.now()}`;
      const task = taskRegistry.create(
        `Handle event ${eventName} for ${route.specialistId}`,
        {
          teamId: route.specialistId,
          action: route.action,
          context: {
            tenantId,
            projectId,
            userId: payload.userId || payload.actor || null,
            role: route.specialistId,
            authorizedCapabilities: payload.authorizedCapabilities || [],
            channel: payload.channel || null,
          },
          input: {
            eventName,
            workId,
            ticketType: route.ticketType,
            specialistId: route.specialistId,
            skillId: route.skillId,
            payload,
          },
        }
      );
      taskRegistry.update(task.taskId, {
        event: { name: eventName, workId },
        routing: { specialistId: route.specialistId, skillId: route.skillId, ticketType: route.ticketType },
      });
      return task;
    };
    eventBus.on(eventName, handler);
    handlers.push([eventName, handler]);
  }
  return () => handlers.forEach(([eventName, handler]) => eventBus.off(eventName, handler));
}

export function createCommerceSpecialistRegistry() {
  return registerCommerceSpecialists(new SpecialistRegistry());
}

export default {
  WBS_SPECIALIST_MAP,
  EVENT_TASK_MAP,
  resolveSpecialistForWorkPackage,
  decorateWorkPackage,
  instantiateRoutedWorkPackages,
  resolveEventTask,
  attachWbsEventTaskBridge,
  createCommerceSpecialistRegistry,
};
