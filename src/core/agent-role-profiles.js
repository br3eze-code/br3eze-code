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
  },
  catalog: {
    label: 'Catalog Specialist',
    description: 'Owns catalog structure, SKU metadata, offer eligibility, and publication readiness.',
    capabilities: ['catalog.read', 'catalog.search', 'catalog.get', 'product.read'],
    approvalRequired: ['catalog.publish', 'product.create', 'product.update'],
    defaultNextAction: 'Verify product identity, eligibility, source evidence, and publication requirements.',
    domains: ['*']
  },
  pricingpromotions: {
    label: 'Pricing and Promotions Specialist',
    description: 'Evaluates prices, discounts, taxes, credits, and promotion proposals.',
    capabilities: ['pricing.read', 'pricing.compare', 'promotion.propose'],
    approvalRequired: ['pricing.publish', 'promotion.publish', 'discount.commit'],
    defaultNextAction: 'Verify currency, price basis, eligibility, and effective dates before proposing a change.',
    domains: ['*']
  },
  inventory: {
    label: 'Inventory Specialist',
    description: 'Controls stock, reservations, capacity, availability, and reconciliation evidence.',
    capabilities: ['inventory.read', 'inventory.search', 'inventory.get', 'inventory.reserve'],
    approvalRequired: ['inventory.adjust', 'inventory.reconcile', 'stock.commit'],
    defaultNextAction: 'Check tenant/site scope, available quantity, reservations, and source freshness.',
    domains: ['*']
  },
  orderscheckout: {
    label: 'Orders and Checkout Specialist',
    description: 'Manages cart preparation, order proposals, checkout state, amendments, and cancellations.',
    capabilities: ['orders.read', 'orders.search', 'checkout.prepare', 'orders.propose'],
    approvalRequired: ['orders.commit', 'orders.cancel', 'orders.refund'],
    defaultNextAction: 'Verify customer, cart, price, inventory reservation, and payment state before commitment.',
    domains: ['*']
  },
  voucheraccess: {
    label: 'Voucher and Access Specialist',
    description: 'Manages voucher validation, access plans, redemption eligibility, and entitlements.',
    capabilities: ['vouchers.read', 'vouchers.validate', 'access.plan.read'],
    approvalRequired: ['vouchers.issue', 'vouchers.redeem', 'entitlement.revoke'],
    defaultNextAction: 'Verify voucher status, plan eligibility, device limits, and redemption scope.',
    domains: ['network', 'commerce', '*']
  },
  billingpayments: {
    label: 'Billing and Payments Specialist',
    description: 'Reconciles invoices and payment state while preparing approval-gated financial actions.',
    capabilities: ['payments.read', 'invoice.read', 'payment.reconcile', 'refund.propose'],
    approvalRequired: ['payment.create', 'refund', 'settlement.release', 'ledger.write'],
    defaultNextAction: 'Verify provider evidence, amount, currency, tenant, and idempotency before proposing settlement.',
    domains: ['*']
  },
  product: {
    label: 'Product Specialist',
    description: 'Routes cross-domain product work to accountable catalog, pricing, inventory, order, and payment specialists.',
    capabilities: ['catalog.read', 'pricing.read', 'inventory.read', 'orders.read', 'vouchers.read', 'payments.read', 'product.route'],
    approvalRequired: ['product.publish', 'catalog.publish'],
    defaultNextAction: 'Identify the product lifecycle stage and hand off to its single accountable domain owner.',
    domains: ['*']
  },
  projectmanager: {
    label: 'Project Manager',
    description: 'Controls scope, milestones, work packages, dependencies, risks, approvals, and project closure.',
    capabilities: ['plan.read', 'plan.create', 'plan.update', 'task.read', 'task.create', 'task.assign', 'risk.read', 'report.create'],
    approvalRequired: ['task.execute', 'scope.change', 'baseline.change', 'project.close'],
    defaultNextAction: 'Confirm scope, owner, dependency, milestone, acceptance evidence, and next action.',
    domains: ['*']
  },
  br3ezeserviceagent: {
    label: 'Br3eze Service Agent',
    description: 'Represents Br3eze Africa as the governed contact specialist for tenant onboarding and Power Connect handoff.',
    capabilities: ['tenant.read', 'tenant.onboard', 'site.read', 'site.onboard', 'pairing.create', 'pairing.read', 'device.enrollment.propose', 'support.create', 'handoff.create'],
    approvalRequired: ['tenant.create', 'site.create', 'device.mutation', 'baseline.apply', 'site.activate'],
    defaultNextAction: 'Resolve the authenticated principal, tenant membership, site scope, and onboarding session before proposing the next step.',
    domains: ['network', 'onboarding', '*']
  }
});

function normalizeAgentRole(value) {
  if (typeof value !== 'string') return null;
  const role = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const aliases = {
    procurementagent: 'procurement',
    purchasing: 'procurement',
    expediting: 'expeditor',
    fulfillmentexpeditor: 'expeditor',
    drafter: 'draftsman',
    secretaryagent: 'secretary',
    accounting: 'accountant',
    qualityassurance: 'qa',
    quality: 'qa',
    catalogspecialist: 'catalog',
    pricingpromotionsspecialist: 'pricingpromotions',
    inventoryspecialist: 'inventory',
    orderscheckoutspecialist: 'orderscheckout',
    voucheraccessspecialist: 'voucheraccess',
    billingpaymentsspecialist: 'billingpayments',
    productspecialist: 'product',
    br3ezecode: 'br3ezeserviceagent'
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
