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
