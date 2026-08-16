const WBS_STATUSES = Object.freeze(['proposed', 'ready', 'in_progress', 'blocked', 'review', 'accepted', 'rejected', 'closed']);

const ROLE_WORK_PACKAGES = Object.freeze({
  planner: [
    ['PLN-001', 'Capture objective and success criteria', 'Define the authorized outcome and measurable acceptance criteria.', [], false],
    ['PLN-002', 'Decompose objective into work packages', 'Create the dependency-aware WBS with owners and milestones.', ['PLN-001'], false],
    ['PLN-003', 'Build baseline schedule', 'Create the Gantt baseline and identify critical path risks.', ['PLN-002'], true],
    ['PLN-004', 'Coordinate handoffs and next actions', 'Track cross-agent handoffs, blockers, and approved replans.', ['PLN-003'], false],
    ['PLN-005', 'Closeout review', 'Confirm deliverables, evidence, unresolved risks, and lessons learned.', ['PLN-004'], true]
  ],
  engineer: [
    ['ENG-001', 'Inspect current state', 'Produce a verified technical baseline before changes.', [], false],
    ['ENG-002', 'Analyse technical risks', 'Record dependencies, failure modes, and rollback considerations.', ['ENG-001'], false],
    ['ENG-003', 'Prepare implementation plan', 'Describe the smallest safe change and its verification plan.', ['ENG-002'], true],
    ['ENG-004', 'Implement and test change', 'Apply the approved change in the authorized environment and test it.', ['ENG-003'], true],
    ['ENG-005', 'Handover and rollback readiness', 'Provide operational documentation and rollback evidence.', ['ENG-004'], true]
  ],
  accountant: [
    ['ACC-001', 'Establish period and currency', 'Confirm financial period, currency, and tenant accounting scope.', [], false],
    ['ACC-002', 'Create cost baseline', 'Allocate approved budget by WBS package and expense category.', ['ACC-001'], true],
    ['ACC-003', 'Reconcile commitments and actuals', 'Match invoices, payments, and commitments to WBS records.', ['ACC-002'], false],
    ['ACC-004', 'Calculate forecast and variance', 'Report actual cost, forecast at completion, and variance.', ['ACC-003'], false],
    ['ACC-005', 'Close financial package', 'Produce final reconciliation and unresolved-exception report.', ['ACC-004'], true]
  ],
  secretary: [
    ['SEC-001', 'Establish stakeholder register', 'Record authorized participants, owners, and communication preferences.', [], false],
    ['SEC-002', 'Prepare meetings and decisions', 'Create agendas and identify decisions required from authorized users.', ['SEC-001'], false],
    ['SEC-003', 'Record decisions and actions', 'Maintain a scoped decision log and follow-up register.', ['SEC-002'], false],
    ['SEC-004', 'Draft and route communications', 'Prepare reviewable messages and notices without sending them.', ['SEC-003'], true],
    ['SEC-005', 'Maintain controlled records', 'Keep the approved record set, revisions, and distribution evidence.', ['SEC-004'], false]
  ],
  procurement: [
    ['PRO-001', 'Capture purchase requirement', 'Structure the item, quantity, specification, budget, and delivery need.', [], false],
    ['PRO-002', 'Validate specification and budget', 'Confirm technical acceptance criteria and available budget.', ['PRO-001'], true],
    ['PRO-003', 'Compare suppliers and quotes', 'Produce a traceable supplier comparison matrix.', ['PRO-002'], false],
    ['PRO-004', 'Prepare purchase proposal', 'Recommend a supplier and document commercial and delivery risks.', ['PRO-003'], true],
    ['PRO-005', 'Issue and receive order', 'Commit the approved order and record receipt evidence.', ['PRO-004'], true]
  ],
  expeditor: [
    ['EXP-001', 'Establish fulfillment milestones', 'Create delivery or service milestones from the approved order.', [], false],
    ['EXP-002', 'Track confirmation and progress', 'Record supplier confirmations, status, and expected dates.', ['EXP-001'], false],
    ['EXP-003', 'Manage exceptions', 'Record delay, dependency, and impact information.', ['EXP-002'], false],
    ['EXP-004', 'Prepare escalation', 'Recommend bounded escalation options for approval.', ['EXP-003'], true],
    ['EXP-005', 'Confirm receipt and close fulfillment', 'Attach inspection, delivery, and acceptance evidence.', ['EXP-004'], true]
  ],
  designer: [
    ['DES-001', 'Extract user and service needs', 'Create a scoped needs and task model.', [], false],
    ['DES-002', 'Define design principles', 'Set measurable experience, service, or system design criteria.', ['DES-001'], false],
    ['DES-003', 'Produce concept options', 'Prepare alternatives and document trade-offs.', ['DES-002'], false],
    ['DES-004', 'Prototype and review', 'Create a prototype and record review findings.', ['DES-003'], true],
    ['DES-005', 'Prepare publishable design', 'Deliver the approved design package and acceptance evidence.', ['DES-004'], true]
  ],
  draftsman: [
    ['DRF-001', 'Confirm source and revision', 'Identify the authoritative source, format, revision, and audience.', [], false],
    ['DRF-002', 'Prepare initial draft', 'Create the document, drawing, diagram, or specification draft.', ['DRF-001'], false],
    ['DRF-003', 'Apply standards and constraints', 'Check structure, terminology, dimensions, references, and required standards.', ['DRF-002'], false],
    ['DRF-004', 'Incorporate review comments', 'Produce a controlled revision with resolved comments.', ['DRF-003'], true],
    ['DRF-005', 'Issue final document', 'Publish the approved document and revision history.', ['DRF-004'], true]
  ],
  qa: [
    ['QA-001', 'Define QA strategy and gates', 'Create acceptance criteria, evidence requirements, and quality gates.', [], true],
    ['QA-002', 'Map gates to schedule and budget', 'Link QA gates to Gantt tasks, WBS packages, and expenditure categories.', ['QA-001'], false],
    ['QA-003', 'Track evidence and defects', 'Maintain evidence readiness, defect, and rework records.', ['QA-002'], false],
    ['QA-004', 'Analyse cost and schedule variance', 'Report actual, forecast, evidence, and rework variance.', ['QA-003'], false],
    ['QA-005', 'Run release quality gate', 'Issue a go/no-go recommendation based on evidence and approved risk.', ['QA-004'], true],
    ['QA-006', 'Reconcile final expenditure and evidence', 'Close the QA package with financial and evidence reconciliation.', ['QA-005'], true]
  ]
});

function validateWorkPackage(packageDefinition) {
  if (!packageDefinition || typeof packageDefinition !== 'object') return { valid: false, errors: ['package_required'] };
  const required = ['wbsId', 'agentRole', 'title', 'objective', 'status', 'dependencies', 'deliverables', 'acceptanceCriteria', 'requiresApproval'];
  const errors = required.filter((field) => packageDefinition[field] === undefined);
  if (!WBS_STATUSES.includes(packageDefinition.status)) errors.push('invalid_status');
  if (!Array.isArray(packageDefinition.dependencies)) errors.push('dependencies_must_be_array');
  if (!Array.isArray(packageDefinition.deliverables)) errors.push('deliverables_must_be_array');
  if (!Array.isArray(packageDefinition.acceptanceCriteria)) errors.push('acceptance_criteria_must_be_array');
  return { valid: errors.length === 0, errors };
}

function instantiateWorkPackages(role, context = {}, options = {}) {
  const definitions = ROLE_WORK_PACKAGES[role] || [];
  const projectId = context.projectId || options.projectId || null;
  return definitions.map(([suffix, title, objective, dependencies, requiresApproval], index) => {
    const workPackage = {
      wbsId: `${options.prefix || 'WP'}-${suffix}`,
      projectId,
      parentWbsId: options.parentWbsId || null,
      agentRole: role,
      domain: context.domain || 'general',
      tenantId: context.tenantId || null,
      siteId: context.siteId || null,
      ownerUserId: context.userId || context.uid || null,
      title,
      objective,
      status: index === 0 ? 'ready' : 'proposed',
      priority: options.priority || 'normal',
      dependencies: dependencies.map((item) => `${options.prefix || 'WP'}-${item}`),
      deliverables: [],
      acceptanceCriteria: [],
      budget: { currency: options.currency || context.currency || 'USD', approved: 0, committed: 0, actual: 0, forecast: 0 },
      qaGate: null,
      requiresApproval,
      evidenceRefs: [],
      nextAction: index === 0 ? 'Review scope and begin the first package.' : null,
      createdAt: options.now || new Date().toISOString(),
      updatedAt: options.now || new Date().toISOString()
    };
    const validation = validateWorkPackage(workPackage);
    if (!validation.valid) throw new Error(`Invalid work package ${workPackage.wbsId}: ${validation.errors.join(', ')}`);
    return workPackage;
  });
}

function getWorkPackageRoles() {
  return Object.keys(ROLE_WORK_PACKAGES);
}

export { WBS_STATUSES, ROLE_WORK_PACKAGES, validateWorkPackage, instantiateWorkPackages, getWorkPackageRoles };
export default { WBS_STATUSES, ROLE_WORK_PACKAGES, validateWorkPackage, instantiateWorkPackages, getWorkPackageRoles };
