/**
 * Domain-neutral professional agent profiles.
 *
 * Profiles describe responsibilities and policy hints; they do not grant
 * permissions by themselves. Tool authorization must still be enforced by
 * the tenant/user capability policy and the execution context.
 */

const PROFILE_DEFINITIONS = Object.freeze({
  planner: {
    label: 'Planner',
    description: 'Turns an authorized objective into a sequenced, measurable work plan.',
    capabilities: ['plan.read', 'plan.create', 'plan.update', 'context.read', 'proposal.create'],
    approvalRequired: ['plan.execute_mutation'],
    defaultNextAction: 'Clarify the desired outcome, constraints, and success criteria.',
    domains: ['*']
  },
  engineer: {
    label: 'Engineer',
    description: 'Investigates systems and prepares or executes bounded technical changes.',
    capabilities: ['diagnostics.read', 'code.read', 'code.propose', 'tool.execute'],
    approvalRequired: ['code.write', 'config.write', 'deploy', 'device.mutation'],
    defaultNextAction: 'Inspect the current state and propose the smallest safe change.',
    domains: ['*']
  },
  accountant: {
    label: 'Accountant',
    description: 'Reconciles authorized financial records, invoices, balances, and settlements.',
    capabilities: ['ledger.read', 'invoice.read', 'reconciliation.propose', 'report.create'],
    approvalRequired: ['payment.create', 'refund', 'settlement.release', 'ledger.write'],
    defaultNextAction: 'Verify the period, currency, tenant, and source records before calculating.',
    domains: ['*']
  },
  secretary: {
    label: 'Secretary',
    description: 'Organizes communications, appointments, records, and follow-up tasks.',
    capabilities: ['calendar.read', 'calendar.propose', 'message.draft', 'record.read', 'task.create'],
    approvalRequired: ['message.send', 'calendar.commit', 'record.share'],
    defaultNextAction: 'Confirm the people, timeframe, channel, and intended outcome.',
    domains: ['*']
  },
  procurement: {
    label: 'Procurement',
    description: 'Finds, compares, and prepares purchase requests within authorized budgets.',
    capabilities: ['catalog.read', 'supplier.read', 'quote.compare', 'purchase.propose', 'inventory.read'],
    approvalRequired: ['purchase.order', 'supplier.commit', 'budget.allocate'],
    defaultNextAction: 'Check requirements, budget, supplier constraints, and delivery target.',
    domains: ['*']
  },
  expeditor: {
    label: 'Expeditor',
    description: 'Tracks fulfillment, dependencies, exceptions, and delivery milestones.',
    capabilities: ['order.read', 'shipment.read', 'milestone.read', 'exception.propose', 'notify.draft'],
    approvalRequired: ['shipment.change', 'vendor.escalate', 'notify.send'],
    defaultNextAction: 'Identify the blocked milestone, owner, deadline, and next escalation.',
    domains: ['*']
  },
  designer: {
    label: 'Designer',
    description: 'Transforms requirements into user, service, or system design proposals.',
    capabilities: ['requirements.read', 'design.propose', 'prototype.create', 'review.request'],
    approvalRequired: ['design.publish', 'asset.publish', 'brand.change'],
    defaultNextAction: 'Extract the user, task, constraints, and acceptance criteria before designing.',
    domains: ['*']
  },
  draftsman: {
    label: 'Draftsman',
    description: 'Produces precise drafts, diagrams, specifications, and structured documents.',
    capabilities: ['document.read', 'document.draft', 'diagram.draft', 'specification.create', 'revision.propose'],
    approvalRequired: ['document.publish', 'drawing.issue', 'specification.approve'],
    defaultNextAction: 'Confirm the source of truth, required format, revision, and audience.',
    domains: ['*']
  },
  qa: {
    label: 'QA Specialist',
    description: 'Defines quality gates, verifies evidence, tracks defects, and recommends acceptance.',
    capabilities: ['qa.read', 'qa.plan', 'evidence.read', 'evidence.capture', 'defect.record', 'report.create'],
    approvalRequired: ['qa.accept', 'qa.waive', 'commissioning.accept'],
    defaultNextAction: 'Confirm acceptance criteria, required evidence, test method, and unresolved defects.',
    domains: ['*']
  }
});

function normalizeAgentRole(value) {
  if (typeof value !== 'string') return null;
  const role = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const aliases = {
    procurementagent: 'procurement',
    purchasing: 'procurement',
    expediting: 'expeditor',
    drafter: 'draftsman',
    secretaryagent: 'secretary',
    accounting: 'accountant',
    qualityassurance: 'qa',
    quality: 'qa'
  };
  const normalized = aliases[role] || role;
  return Object.hasOwn(PROFILE_DEFINITIONS, normalized) ? normalized : null;
}

function resolveAgentRole(input = {}) {
  return normalizeAgentRole(input.agentRole || input.agentPersona || input.professionalRole || input.role) || null;
}

function getAgentRoleProfile(role) {
  const normalized = normalizeAgentRole(role);
  if (!normalized) return null;
  const profile = PROFILE_DEFINITIONS[normalized];
  return {
    role: normalized,
    ...profile,
    capabilities: [...profile.capabilities],
    approvalRequired: [...profile.approvalRequired],
    domains: [...profile.domains]
  };
}

function isApprovalRequired(role, action) {
  const profile = getAgentRoleProfile(role);
  if (!profile || typeof action !== 'string') return false;
  return profile.approvalRequired.some((required) => action === required || action.startsWith(`${required}.`) || action.startsWith(`${required}:`));
}

export {
  PROFILE_DEFINITIONS,
  normalizeAgentRole,
  resolveAgentRole,
  getAgentRoleProfile,
  isApprovalRequired
};

export default {
  PROFILE_DEFINITIONS,
  normalizeAgentRole,
  resolveAgentRole,
  getAgentRoleProfile,
  isApprovalRequired
};
