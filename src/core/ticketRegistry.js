import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import { getSpecialistTeam, canHandoff } from './specialist-agent-roster.js';

const TicketStatus = Object.freeze({
    OPEN: 'open',
    BLOCKED: 'blocked',
    IN_PROGRESS: 'in_progress',
    HANDOFF: 'handoff',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
});

const TERMINAL = new Set([TicketStatus.COMPLETED, TicketStatus.FAILED, TicketStatus.CANCELLED]);

const hasPermission = (actor, permission) => Boolean(actor && (actor.roles?.includes('admin') || actor.roles?.includes('project-manager') || actor.permissions?.includes('*') || actor.permissions?.includes(permission)));
const actorId = actor => actor?.id || actor?.userId || actor?.subject || null;

class TicketRegistry extends EventEmitter {
    constructor({ requireTenantScope = false } = {}) {
        super();
        this.tickets = new Map();
        this.idempotency = new Map();
        this.requireTenantScope = requireTenantScope;
    }

    create({
        title,
        domain = 'core',
        specialist,
        dependencies = [],
        owner = null,
        payload = {},
        priority = 'normal',
        parentTicketId = null,
        tenantId = null,
        idempotencyKey = null,
        actor = null
    } = {}) {
        if (!title || typeof title !== 'string') throw Object.assign(new TypeError('ticket title is required'), { code: 'TICKET_INPUT_INVALID' });
        if (this.requireTenantScope && !tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'TENANT_SCOPE_REQUIRED' });
        if (this.requireTenantScope && !hasPermission(actor, 'ticket:create')) throw Object.assign(new Error('actor is not authorized to create tickets'), { code: 'ACTOR_NOT_AUTHORIZED', permission: 'ticket:create' });
        if (idempotencyKey !== null && (!tenantId || typeof idempotencyKey !== 'string' || !idempotencyKey.trim())) throw Object.assign(new Error('idempotencyKey requires a tenant-scoped ticket'), { code: 'IDEMPOTENCY_SCOPE_REQUIRED' });
        const team = getSpecialistTeam(specialist);
        if (!team) throw Object.assign(new Error(`unknown specialist: ${specialist}`), { code: 'SPECIALIST_NOT_FOUND' });
        const idempotencyId = idempotencyKey ? `${tenantId}:${idempotencyKey}` : null;
        if (idempotencyId && this.idempotency.has(idempotencyId)) return this.get(this.idempotency.get(idempotencyId), { tenantId });
        for (const dependencyId of dependencies) {
            const dependency = this.require(dependencyId, { tenantId });
            if (tenantId && dependency.tenantId !== tenantId) throw Object.assign(new Error('dependency is outside the requested tenant'), { code: 'TENANT_SCOPE_MISMATCH' });
        }
        const now = Date.now();
        const id = `TKT-${uuidv4()}`;
        const ticket = {
            id, title, domain, tenantId, specialist: team.id, skill: team.skill, owner, actor,
            status: dependencies.length ? TicketStatus.BLOCKED : TicketStatus.OPEN,
            priority, dependencies: [...dependencies], parentTicketId, idempotencyKey,
            handoff: null, evidence: [], payload,
            history: [{ event: 'created', at: now, specialist: team.id, actor }],
            createdAt: now, updatedAt: now
        };
        this.tickets.set(id, ticket);
        if (idempotencyId) this.idempotency.set(idempotencyId, id);
        this.emit('ticket:created', this.get(id, { tenantId }));
        return this.get(id, { tenantId });
    }

    get(id, scope = {}) {
        const ticket = this.tickets.get(id);
        if (!ticket) return null;
        this.assertScope(ticket, scope);
        return structuredClone(ticket);
    }

    list({ status = null, specialist = null, domain = null, tenantId = null, actor = null } = {}) {
        this.assertRead({ tenantId, actor });
        return [...this.tickets.values()]
            .filter((ticket) => !tenantId || ticket.tenantId === tenantId)
            .filter((ticket) => !status || ticket.status === status)
            .filter((ticket) => !specialist || ticket.specialist === specialist || ticket.skill === specialist)
            .filter((ticket) => !domain || ticket.domain === domain)
            .map((ticket) => structuredClone(ticket));
    }

    dependenciesComplete(id, scope = {}) {
        const ticket = this.require(id, scope);
        return ticket.dependencies.every((dependencyId) => {
            const dependency = this.tickets.get(dependencyId);
            return dependency && dependency.status === TicketStatus.COMPLETED && dependency.tenantId === ticket.tenantId;
        });
    }

    start(id, scope = {}) {
        const ticket = this.require(id, scope);
        this.assertMutation(ticket, scope, 'ticket:start');
        if (TERMINAL.has(ticket.status)) throw new Error(`ticket ${id} is terminal`);
        if (!this.dependenciesComplete(id, scope)) {
            ticket.status = TicketStatus.BLOCKED;
            this.record(ticket, 'blocked', null, scope);
            return this.get(id, scope);
        }
        ticket.status = TicketStatus.IN_PROGRESS;
        this.record(ticket, 'started', null, scope);
        return this.get(id, scope);
    }

    addEvidence(id, evidence, scope = {}) {
        if (!evidence || typeof evidence !== 'object') throw new TypeError('evidence must be an object');
        const ticket = this.require(id, scope);
        this.assertMutation(ticket, scope, 'ticket:evidence');
        ticket.evidence.push({ ...evidence, at: Date.now() });
        this.record(ticket, 'evidence_added', null, scope);
        return this.get(id, scope);
    }

    handoff(id, toSpecialist, { reason = null, evidence = null, ...scope } = {}) {
        const ticket = this.require(id, scope);
        this.assertMutation(ticket, scope, 'ticket:handoff');
        const target = getSpecialistTeam(toSpecialist);
        if (!target) throw new Error(`unknown specialist: ${toSpecialist}`);
        if (!canHandoff(ticket.specialist, target.id)) throw new Error(`handoff not permitted: ${ticket.specialist} -> ${target.id}`);
        if (evidence) this.addEvidence(id, evidence, scope);
        ticket.handoff = { from: ticket.specialist, to: target.id, reason, at: Date.now() };
        ticket.specialist = target.id;
        ticket.skill = target.skill;
        ticket.status = TicketStatus.HANDOFF;
        this.record(ticket, 'handoff', null, scope);
        return this.get(id, scope);
    }

    complete(id, evidence = null, scope = {}) {
        const ticket = this.require(id, scope);
        this.assertMutation(ticket, scope, 'ticket:complete');
        if (!this.dependenciesComplete(id, scope)) throw new Error(`cannot complete ${id}: dependencies incomplete`);
        if (evidence) this.addEvidence(id, evidence, scope);
        ticket.status = TicketStatus.COMPLETED;
        this.record(ticket, 'completed', null, scope);
        this.unblockDependents(id, scope);
        return this.get(id, scope);
    }

    fail(id, reason = null, scope = {}) {
        const ticket = this.require(id, scope);
        this.assertMutation(ticket, scope, 'ticket:manage');
        ticket.status = TicketStatus.FAILED;
        this.record(ticket, 'failed', reason, scope);
        return this.get(id, scope);
    }

    cancel(id, reason = null, scope = {}) {
        const ticket = this.require(id, scope);
        this.assertMutation(ticket, scope, 'ticket:manage');
        ticket.status = TicketStatus.CANCELLED;
        this.record(ticket, 'cancelled', reason, scope);
        return this.get(id, scope);
    }

    summary({ domain = null, tenantId = null, actor = null } = {}) {
        const tickets = this.list({ domain, tenantId, actor });
        const counts = Object.fromEntries(Object.values(TicketStatus).map((status) => [status, 0]));
        for (const ticket of tickets) counts[ticket.status]++;
        return { total: tickets.length, ...counts };
    }

    require(id, scope = {}) {
        const ticket = this.tickets.get(id);
        if (!ticket) throw Object.assign(new Error(`unknown ticket: ${id}`), { code: 'TICKET_NOT_FOUND' });
        this.assertScope(ticket, scope);
        return ticket;
    }

    assertScope(ticket, { tenantId = null } = {}) {
        if (this.requireTenantScope && !tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'TENANT_SCOPE_REQUIRED' });
        if (ticket.tenantId && tenantId !== ticket.tenantId) throw Object.assign(new Error('ticket is outside the requested tenant'), { code: 'TENANT_SCOPE_MISMATCH' });
        if (this.requireTenantScope && !ticket.tenantId) throw Object.assign(new Error('ticket has no tenant scope'), { code: 'TENANT_SCOPE_MISSING' });
    }

    assertRead({ tenantId = null, actor = null } = {}) {
        if (!this.requireTenantScope) return;
        if (!tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'TENANT_SCOPE_REQUIRED' });
        if (!actorId(actor)) throw Object.assign(new Error('actor identity is required'), { code: 'ACTOR_REQUIRED' });
        if (actor.tenantId !== tenantId) throw Object.assign(new Error('actor is outside the requested tenant'), { code: 'ACTOR_TENANT_MISMATCH' });
        if (!hasPermission(actor, 'ticket:read')) throw Object.assign(new Error('actor is not authorized for ticket:read'), { code: 'ACTOR_NOT_AUTHORIZED', permission: 'ticket:read' });
    }

    assertMutation(ticket, { tenantId = null, actor = null } = {}, permission) {
        this.assertScope(ticket, { tenantId });
        if (!this.requireTenantScope) return;
        if (!actorId(actor)) throw Object.assign(new Error('actor identity is required'), { code: 'ACTOR_REQUIRED' });
        if (actor.tenantId !== tenantId) throw Object.assign(new Error('actor is outside the requested tenant'), { code: 'ACTOR_TENANT_MISMATCH' });
        const ownsTicket = actor.specialistId === ticket.specialist || actor.userId === ticket.owner;
        if (!hasPermission(actor, permission) && !ownsTicket) throw Object.assign(new Error(`actor is not authorized for ${permission}`), { code: 'ACTOR_NOT_AUTHORIZED', permission });
    }

    record(ticket, event, reason = null, scope = {}) {
        this.assertScope(ticket, scope);
        ticket.updatedAt = Date.now();
        ticket.history.push({ event, reason, at: ticket.updatedAt, specialist: ticket.specialist, actor: scope.actor || null });
        this.emit(`ticket:${event}`, this.get(ticket.id, scope));
    }

    unblockDependents(completedId, scope = {}) {
        const completed = this.require(completedId, scope);
        for (const ticket of this.tickets.values()) {
            if (ticket.status === TicketStatus.BLOCKED && ticket.dependencies.includes(completedId) && ticket.tenantId === completed.tenantId && this.dependenciesComplete(ticket.id, scope)) {
                ticket.status = TicketStatus.OPEN;
                this.record(ticket, 'unblocked', null, scope);
            }
        }
    }
}

let instance = null;
function getTicketRegistry() {
    if (!instance) instance = new TicketRegistry({ requireTenantScope: process.env.AGENTOS_REQUIRE_TENANT_SCOPE !== 'false' });
    return instance;
}

export { TicketRegistry, TicketStatus, getTicketRegistry };
export default { TicketRegistry, TicketStatus, getTicketRegistry };
