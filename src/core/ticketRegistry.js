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

const TERMINAL = new Set([
    TicketStatus.COMPLETED,
    TicketStatus.FAILED,
    TicketStatus.CANCELLED
]);

class TicketRegistry extends EventEmitter {
    constructor() {
        super();
        this.tickets = new Map();
    }

    create({
        title,
        domain = 'core',
        specialist,
        dependencies = [],
        owner = null,
        payload = {},
        priority = 'normal',
        parentTicketId = null
    } = {}) {
        if (!title || typeof title !== 'string') throw new TypeError('ticket title is required');
        const team = getSpecialistTeam(specialist);
        if (!team) throw new Error(`unknown specialist: ${specialist}`);
        for (const dependencyId of dependencies) {
            if (!this.tickets.has(dependencyId)) throw new Error(`unknown ticket dependency: ${dependencyId}`);
        }
        const now = Date.now();
        const id = `TKT-${uuidv4()}`;
        const ticket = {
            id,
            title,
            domain,
            specialist: team.id,
            skill: team.skill,
            owner,
            status: dependencies.length ? TicketStatus.BLOCKED : TicketStatus.OPEN,
            priority,
            dependencies: [...dependencies],
            parentTicketId,
            handoff: null,
            evidence: [],
            payload,
            history: [{ event: 'created', at: now, specialist: team.id }],
            createdAt: now,
            updatedAt: now
        };
        this.tickets.set(id, ticket);
        this.emit('ticket:created', this.get(id));
        return this.get(id);
    }

    get(id) {
        const ticket = this.tickets.get(id);
        return ticket ? structuredClone(ticket) : null;
    }

    list({ status = null, specialist = null, domain = null } = {}) {
        return [...this.tickets.values()]
            .filter((ticket) => !status || ticket.status === status)
            .filter((ticket) => !specialist || ticket.specialist === specialist || ticket.skill === specialist)
            .filter((ticket) => !domain || ticket.domain === domain)
            .map((ticket) => structuredClone(ticket));
    }

    dependenciesComplete(id) {
        const ticket = this.tickets.get(id);
        if (!ticket) return false;
        return ticket.dependencies.every((dependencyId) => {
            const dependency = this.tickets.get(dependencyId);
            return dependency && dependency.status === TicketStatus.COMPLETED;
        });
    }

    start(id) {
        const ticket = this.require(id);
        if (TERMINAL.has(ticket.status)) throw new Error(`ticket ${id} is terminal`);
        if (!this.dependenciesComplete(id)) {
            ticket.status = TicketStatus.BLOCKED;
            this.record(ticket, 'blocked');
            return this.get(id);
        }
        ticket.status = TicketStatus.IN_PROGRESS;
        this.record(ticket, 'started');
        return this.get(id);
    }

    addEvidence(id, evidence) {
        if (!evidence || typeof evidence !== 'object') throw new TypeError('evidence must be an object');
        const ticket = this.require(id);
        ticket.evidence.push({ ...evidence, at: Date.now() });
        ticket.updatedAt = Date.now();
        this.record(ticket, 'evidence_added');
        return this.get(id);
    }

    handoff(id, toSpecialist, { reason = null, evidence = null } = {}) {
        const ticket = this.require(id);
        const target = getSpecialistTeam(toSpecialist);
        if (!target) throw new Error(`unknown specialist: ${toSpecialist}`);
        if (!canHandoff(ticket.specialist, target.id)) {
            throw new Error(`handoff not permitted: ${ticket.specialist} -> ${target.id}`);
        }
        if (evidence) this.addEvidence(id, evidence);
        ticket.handoff = {
            from: ticket.specialist,
            to: target.id,
            reason,
            at: Date.now()
        };
        ticket.specialist = target.id;
        ticket.skill = target.skill;
        ticket.status = TicketStatus.HANDOFF;
        this.record(ticket, 'handoff');
        return this.get(id);
    }

    complete(id, evidence = null) {
        const ticket = this.require(id);
        if (!this.dependenciesComplete(id)) throw new Error(`cannot complete ${id}: dependencies incomplete`);
        if (evidence) this.addEvidence(id, evidence);
        ticket.status = TicketStatus.COMPLETED;
        this.record(ticket, 'completed');
        this.unblockDependents(id);
        return this.get(id);
    }

    fail(id, reason = null) {
        const ticket = this.require(id);
        ticket.status = TicketStatus.FAILED;
        this.record(ticket, 'failed', reason);
        return this.get(id);
    }

    cancel(id, reason = null) {
        const ticket = this.require(id);
        ticket.status = TicketStatus.CANCELLED;
        this.record(ticket, 'cancelled', reason);
        return this.get(id);
    }

    summary({ domain = null } = {}) {
        const tickets = this.list({ domain });
        const counts = Object.fromEntries(Object.values(TicketStatus).map((status) => [status, 0]));
        for (const ticket of tickets) counts[ticket.status]++;
        return { total: tickets.length, ...counts };
    }

    require(id) {
        const ticket = this.tickets.get(id);
        if (!ticket) throw new Error(`unknown ticket: ${id}`);
        return ticket;
    }

    record(ticket, event, reason = null) {
        ticket.updatedAt = Date.now();
        ticket.history.push({ event, reason, at: ticket.updatedAt, specialist: ticket.specialist });
        this.emit(`ticket:${event}`, this.get(ticket.id));
    }

    unblockDependents(completedId) {
        for (const ticket of this.tickets.values()) {
            if (ticket.status === TicketStatus.BLOCKED && ticket.dependencies.includes(completedId) && this.dependenciesComplete(ticket.id)) {
                ticket.status = TicketStatus.OPEN;
                this.record(ticket, 'unblocked');
            }
        }
    }
}

let instance = null;
function getTicketRegistry() {
    if (!instance) instance = new TicketRegistry();
    return instance;
}

export { TicketRegistry, TicketStatus, getTicketRegistry };
export default { TicketRegistry, TicketStatus, getTicketRegistry };
