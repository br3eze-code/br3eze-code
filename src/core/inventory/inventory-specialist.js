import { z } from 'zod';

export const INVENTORY_SPECIALIST = Object.freeze({
  id: 'inventory-specialist',
  name: 'Inventory Specialist',
  domain: 'commerce',
  description: 'Controls stock, availability, and reservations.',
  skills: ['inventory-specialist'],
  tools: ['inventory.get', 'inventory.reserve'],
  permissions: ['inventory:read', 'inventory:reserve'],
  dependsOn: ['catalog', 'orders-checkout'],
  handoffsTo: ['orders-checkout', 'fulfillment-expeditor', 'product'],
});

const getInput = z
  .object({
    sku: z.string().trim().min(1),
  })
  .strict();

const reserveInput = z
  .object({
    sku: z.string().trim().min(1),
    quantity: z.number().int().positive(),
    orderId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1),
  })
  .strict();

const getOutput = z.object({
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});

const reserveOutput = z.object({
  reservationId: z.string().min(1),
  sku: z.string(),
  quantity: z.number().int().positive(),
  orderId: z.string(),
  status: z.literal('reserved'),
  idempotencyKey: z.string(),
  reservedAt: z.string(),
  idempotent: z.boolean(),
});

export function createInventorySpecialist({ adapter }) {
  if (!adapter || typeof adapter.get !== 'function' || typeof adapter.reserve !== 'function') {
    throw new TypeError('Inventory specialist requires an adapter with get and reserve methods');
  }

  return {
    ...INVENTORY_SPECIALIST,
    toolDefinitions: [
      {
        name: 'get',
        description: 'Read stock and availability for an SKU.',
        skill: 'inventory-specialist',
        permissions: ['inventory:read'],
        riskLevel: 'low',
        audit: event => ({
          type: 'inventory.audit',
          tool: event.tool,
          executionId: event.executionId,
          status: event.status,
          riskLevel: 'low',
        }),
        inputSchema: getInput,
        outputSchema: getOutput,
        execute: async input => adapter.get(input.sku),
      },
      {
        name: 'reserve',
        description: 'Atomically reserve stock for an order.',
        skill: 'inventory-specialist',
        permissions: ['inventory:reserve'],
        riskLevel: 'medium',
        requiresApproval: true,
        audit: event => ({
          type: 'inventory.audit',
          tool: event.tool,
          executionId: event.executionId,
          status: event.status,
          riskLevel: 'medium',
        }),
        inputSchema: reserveInput,
        outputSchema: reserveOutput,
        execute: async input => adapter.reserve(input),
      },
    ],
  };
}

export const inventorySchemas = Object.freeze({
  getInput,
  getOutput,
  reserveInput,
  reserveOutput,
});
