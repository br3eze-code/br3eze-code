import eventBus from './eventBus.js';
import { buildActivityIdentity, normalizeSpecialistActivity } from './specialist-activity.js';

const EXCEPTION_STATES = Object.freeze([
  'detected',
  'evidence_requested',
  'supplier_response_pending',
  'recovery_proposed',
  'approval_required',
  'approved',
  'rejected',
  'resolved',
  'closed',
]);

const RECOVERY_TYPES = Object.freeze([
  'expedite',
  'partial_delivery',
  'alternate_supplier',
  're_tender',
  'buy_make_review',
  'scope_replan',
  'accept_delay',
]);

function requireScope(context = {}) {
  for (const field of ['tenantId', 'projectId', 'userId']) {
    if (!context[field]) throw new Error(`${field} is required for fulfillment exception coordination`);
  }
}

function assertSameTenant(context, record = {}) {
  if (record.tenantId && record.tenantId !== context.tenantId) {
    throw Object.assign(new Error('Cross-tenant fulfillment record rejected'), { code: 'TENANT_SCOPE_VIOLATION', status: 403 });
  }
}

function normalizeState(state) {
  const value = String(state || 'detected').toLowerCase();
  if (!EXCEPTION_STATES.includes(value)) throw new Error(`Unsupported fulfillment exception state: ${state}`);
  return value;
}

function normalizeRecovery(type) {
  const value = String(type || '').toLowerCase();
  if (!RECOVERY_TYPES.includes(value)) throw new Error(`Unsupported recovery type: ${type}`);
  return value;
}

function unique(values = []) { return [...new Set(values.filter(Boolean).map(String))]; }

/**
 * Coordinates Expeditor findings with Procurement decisions without allowing
 * either specialist to commit a supplier, purchase order, or shipment change.
 */
export class FulfillmentExceptionCoordinator {
  constructor({ projectManager, bus = eventBus, now = () => new Date().toISOString() } = {}) {
    if (!projectManager) throw new Error('projectManager is required');
    this.projectManager = projectManager;
    this.bus = bus;
    this.now = now;
  }

  detectDelay({ context = {}, order = {}, milestone = {}, providerEvent = null, reason = null } = {}) {
    requireScope(context);
    assertSameTenant(context, order);
    const activityIdentity = buildActivityIdentity({
      tenantId: context.tenantId,
      projectId: context.projectId,
      wbsId: 'WP-EXP-003',
      agentRole: 'expeditor',
    });
    const expectedAt = milestone.expectedAt || milestone.dueAt || null;
    const actualAt = providerEvent?.occurredAt || this.now();
    const delayed = Boolean(milestone.delayed || (expectedAt && actualAt > expectedAt));
    const exception = {
      exceptionId: `EXC-${order.orderId || order.id || 'unknown'}-${Date.now()}`,
      tenantId: context.tenantId,
      projectId: context.projectId,
      siteId: context.siteId || order.siteId || null,
      domain: context.domain || order.domain || 'general',
      orderId: order.orderId || order.id || null,
      supplierId: order.supplierId || null,
      provider: providerEvent?.provider || order.provider || null,
      trackingId: providerEvent?.trackingId || order.trackingId || null,
      state: delayed ? 'detected' : 'resolved',
      reason: reason || (delayed ? 'milestone_late' : null),
      expectedAt,
      actualAt,
      providerStatus: providerEvent?.status || providerEvent?.state || null,
      evidenceRefs: unique([providerEvent?.evidenceRef, ...(providerEvent?.evidenceRefs || [])]),
      impact: { scheduleDays: 0, cost: 0, currency: order.currency || null, quality: 'unknown' },
      activity: normalizeSpecialistActivity({
        ...activityIdentity,
        ...context,
        wbsId: 'WP-EXP-003',
        workId: 'EXP-003',
        agentRole: 'expeditor',
        status: delayed ? 'proposed' : 'verified',
        eventType: 'fulfillment.exception.detected',
        occurredAt: this.now(),
      }),
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.bus.emit('fulfillment.exception.detected', exception);
    return exception;
  }

  async requestProcurementResponse({ context = {}, exception, procurementWbsId = 'WP-PRO-003' } = {}) {
    requireScope(context);
    if (!exception) throw new Error('exception is required');
    assertSameTenant(context, exception);
    const payload = {
      exceptionId: exception.exceptionId,
      orderId: exception.orderId,
      supplierId: exception.supplierId,
      reason: exception.reason,
      expectedAt: exception.expectedAt,
      actualAt: exception.actualAt,
      providerStatus: exception.providerStatus,
      evidenceRefs: exception.evidenceRefs,
      requestedInputs: ['supplier response', 'revised delivery date', 'alternate supplier options', 'commercial impact'],
      nextAction: 'Procurement to assess supplier response and recovery options',
    };
    const handoff = await this.projectManager.proposeHandoff({
      wbsId: procurementWbsId,
      fromRole: 'expeditor',
      toRole: 'procurement',
      context,
      payload,
    });
    const updated = { ...exception, state: 'supplier_response_pending', updatedAt: this.now(), procurementHandoffId: handoff.handoffId || handoff.id || null };
    this.bus.emit('fulfillment.exception.procurement_requested', updated);
    return { exception: updated, handoff };
  }

  proposeRecovery({ context = {}, exception, options = [] } = {}) {
    requireScope(context);
    if (!exception) throw new Error('exception is required');
    assertSameTenant(context, exception);
    if (exception.state !== 'supplier_response_pending' && exception.state !== 'detected') {
      throw new Error(`Cannot propose recovery from exception state ${exception.state}`);
    }
    const normalizedOptions = options.map((option) => ({
      ...option,
      type: normalizeRecovery(option.type),
      requiresApproval: true,
      evidenceRefs: unique(option.evidenceRefs || []),
      timeImpactDays: Number(option.timeImpactDays || 0),
      costImpact: Number(option.costImpact || 0),
    }));
    if (!normalizedOptions.length) throw new Error('At least one recovery option is required');
    const proposal = {
      ...exception,
      state: 'recovery_proposed',
      options: normalizedOptions,
      recommendedOption: normalizedOptions.find((option) => option.recommended)?.type || normalizedOptions[0].type,
      updatedAt: this.now(),
      activity: { ...exception.activity, status: 'submitted', eventType: 'fulfillment.recovery.proposed', occurredAt: this.now() },
    };
    this.bus.emit('fulfillment.recovery.proposed', proposal);
    return proposal;
  }

  approveRecovery({ context = {}, proposal, optionType } = {}) {
    requireScope(context);
    if (!context.approvalGranted) return { status: 'approval_required', exceptionId: proposal?.exceptionId, action: 'supplier.commit_or_scope_change' };
    if (!proposal) throw new Error('proposal is required');
    assertSameTenant(context, proposal);
    const selected = normalizeRecovery(optionType || proposal.recommendedOption);
    if (!proposal.options?.some((option) => option.type === selected)) throw new Error(`Recovery option not found: ${selected}`);
    const approved = { ...proposal, state: 'approved', approvedOption: selected, approvedBy: context.userId, approvedAt: this.now(), updatedAt: this.now() };
    this.bus.emit('fulfillment.recovery.approved', approved);
    return approved;
  }

  close({ context = {}, exception, evidenceRefs = [], resolution = null } = {}) {
    requireScope(context);
    if (!exception) throw new Error('exception is required');
    assertSameTenant(context, exception);
    if (!['approved', 'resolved'].includes(exception.state)) throw new Error(`Cannot close exception from state ${exception.state}`);
    const closed = { ...exception, state: 'closed', resolution, evidenceRefs: unique([...(exception.evidenceRefs || []), ...evidenceRefs]), closedBy: context.userId, closedAt: this.now(), updatedAt: this.now() };
    this.bus.emit('fulfillment.exception.closed', closed);
    return closed;
  }
}

export { EXCEPTION_STATES, RECOVERY_TYPES };
export default { FulfillmentExceptionCoordinator, EXCEPTION_STATES, RECOVERY_TYPES };
