import { TicketRegistry, TicketStatus } from '../src/core/ticketRegistry.js';

describe('TicketRegistry', () => {
    test('creates a ticket owned by a registered specialist', () => {
        const registry = new TicketRegistry();
        const ticket = registry.create({
            title: 'Reserve catalog stock',
            domain: 'commerce',
            specialist: 'inventory-specialist'
        });

        expect(ticket.specialist).toBe('inventory');
        expect(ticket.skill).toBe('inventory-specialist');
        expect(ticket.status).toBe(TicketStatus.OPEN);
    });

    test('blocks a ticket until all dependencies complete', () => {
        const registry = new TicketRegistry();
        const dependency = registry.create({ title: 'Publish SKU', specialist: 'catalog-specialist', domain: 'commerce' });
        const dependent = registry.create({
            title: 'Reserve SKU',
            specialist: 'inventory-specialist',
            domain: 'commerce',
            dependencies: [dependency.id]
        });

        expect(dependent.status).toBe(TicketStatus.BLOCKED);
        expect(registry.start(dependent.id).status).toBe(TicketStatus.BLOCKED);

        registry.complete(dependency.id);
        expect(registry.get(dependent.id).status).toBe(TicketStatus.OPEN);
        expect(registry.start(dependent.id).status).toBe(TicketStatus.IN_PROGRESS);
    });

    test('allows only roster-defined handoffs', () => {
        const registry = new TicketRegistry();
        const ticket = registry.create({ title: 'Prepare checkout', specialist: 'catalog-specialist', domain: 'commerce' });

        expect(() => registry.handoff(ticket.id, 'inventory-specialist')).not.toThrow();
        expect(registry.get(ticket.id).specialist).toBe('inventory');
        expect(() => registry.handoff(ticket.id, 'designer')).toThrow(/handoff not permitted/);
    });

    test('records evidence and completion history', () => {
        const registry = new TicketRegistry();
        const ticket = registry.create({ title: 'Reconcile payment', specialist: 'billing-payments-specialist', domain: 'commerce' });

        registry.start(ticket.id);
        registry.complete(ticket.id, { type: 'payment-receipt', reference: 'PAY-1' });
        const result = registry.get(ticket.id);

        expect(result.status).toBe(TicketStatus.COMPLETED);
        expect(result.evidence).toHaveLength(1);
        expect(result.evidence[0].reference).toBe('PAY-1');
        expect(result.history.map((entry) => entry.event)).toEqual(['created', 'started', 'evidence_added', 'completed']);
    });

    test('provides filtered list and summary APIs', () => {
        const registry = new TicketRegistry();
        registry.create({ title: 'A', specialist: 'catalog-specialist', domain: 'commerce' });
        registry.create({ title: 'B', specialist: 'billing-payments-specialist', domain: 'commerce' });
        registry.create({ title: 'C', specialist: 'project-manager', domain: 'core' });

        expect(registry.list({ domain: 'commerce' })).toHaveLength(2);
        expect(registry.list({ specialist: 'billing-payments' })).toHaveLength(1);
        expect(registry.summary({ domain: 'commerce' })).toMatchObject({ total: 2, open: 2 });
    });
});

test('strict registry requires tenant scope and returns idempotent ticket creation', () => {
    const registry = new TicketRegistry({ requireTenantScope: true });
    const creator = { id: 'user-1', tenantId: 'tenant-1', permissions: ['ticket:create'] };
    expect(() => registry.create({ title: 'Unscoped', specialist: 'inventory-specialist', actor: creator })).toThrow(/tenantId is required/);
    const first = registry.create({ title: 'Scoped reservation', specialist: 'inventory-specialist', tenantId: 'tenant-1', idempotencyKey: 'message-1', actor: creator });
    const replay = registry.create({ title: 'Scoped reservation replay', specialist: 'inventory-specialist', tenantId: 'tenant-1', idempotencyKey: 'message-1', actor: creator });
    expect(replay.id).toBe(first.id);
    expect(() => registry.get(first.id, { tenantId: 'tenant-2' })).toThrow(/outside the requested tenant/);
    expect(registry.get(first.id, { tenantId: 'tenant-1' }).tenantId).toBe('tenant-1');
});

test('strict registry authorizes every mutation boundary', () => {
    const registry = new TicketRegistry({ requireTenantScope: true });
    const creator = { id: 'creator', tenantId: 'tenant-1', permissions: ['ticket:create'] };
    const operator = { id: 'operator', tenantId: 'tenant-1', permissions: ['ticket:start', 'ticket:evidence', 'ticket:handoff', 'ticket:complete', 'ticket:manage'] };
    const outsider = { id: 'outsider', tenantId: 'tenant-2', permissions: ['*'] };
    const scope = actor => ({ tenantId: 'tenant-1', actor });
    const ticket = registry.create({ title: 'Authorized lifecycle', specialist: 'inventory-specialist', tenantId: 'tenant-1', actor: creator });

    expect(() => registry.start(ticket.id, scope(outsider))).toThrow(/outside the requested tenant|actor is outside/);
    expect(() => registry.start(ticket.id, { tenantId: 'tenant-1' })).toThrow(/actor identity is required/);
    registry.start(ticket.id, scope(operator));
    registry.addEvidence(ticket.id, { type: 'check', reference: 'E-1' }, scope(operator));
    registry.handoff(ticket.id, 'orders-checkout-specialist', { ...scope(operator), reason: 'checkout dependency' });
    expect(() => registry.complete(ticket.id, { type: 'done' }, scope(outsider))).toThrow(/outside the requested tenant|actor is outside/);
    registry.complete(ticket.id, { type: 'done' }, scope(operator));

    const denied = registry.create({ title: 'Denied create', specialist: 'inventory-specialist', tenantId: 'tenant-1', actor: creator });
    expect(() => registry.fail(denied.id, 'not allowed', { tenantId: 'tenant-1', actor: { id: 'nope', tenantId: 'tenant-1', permissions: [] } })).toThrow(/not authorized/);
    expect(() => registry.cancel(denied.id, 'not allowed', { tenantId: 'tenant-1', actor: { id: 'nope', tenantId: 'tenant-1', permissions: [] } })).toThrow(/not authorized/);
});

test('strict registry authorizes tenant-scoped ticket reads', () => {
    const registry = new TicketRegistry({ requireTenantScope: true });
    const creator = { id: 'creator', tenantId: 'tenant-1', permissions: ['ticket:create'] };
    const reader = { id: 'reader', tenantId: 'tenant-1', permissions: ['ticket:read'] };
    registry.create({ title: 'Readable ticket', specialist: 'inventory-specialist', tenantId: 'tenant-1', actor: creator });

    expect(() => registry.list({ tenantId: 'tenant-1' })).toThrow(/actor identity is required/);
    expect(() => registry.summary({ tenantId: 'tenant-1', actor: { id: 'denied', tenantId: 'tenant-1', permissions: [] } })).toThrow(/ticket:read/);
    expect(() => registry.list({ tenantId: 'tenant-2', actor: reader })).toThrow(/outside the requested tenant/);
    expect(registry.summary({ tenantId: 'tenant-1', actor: reader })).toMatchObject({ total: 1, open: 1 });
});
