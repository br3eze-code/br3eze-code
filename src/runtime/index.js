/**
 * AgentOS runtime — a domain-agnostic agent library + runtime.
 *
 * The public entry point. Build an agent for ANY domain by composing skills:
 *
 *     const { createRuntime, defineSkill, defineTool } = require('agentos/runtime');
 *     const rt = createRuntime({ llm });
 *     rt.use(defineSkill({
 *       name: 'weather',
 *       tools: [defineTool({ name: 'forecast', description: '...', handler: async (a) => {...} })],
 *       match: (input) => /weather/i.test(input) ? { tool: 'forecast', args: {} } : null,
 *     }));
 *     await rt.run('what is the weather');
 *
 * The runtime core has no domain knowledge — MikroTik, the shop, etc. are all
 * skills. See ./skills for first-party skill adapters.
 */
'use strict';

export { Runtime, createRuntime } from './runtime.js';
export { Registry } from './registry.js';
export { SpecialistRegistry } from './specialist-registry.js';
export { INVENTORY_SPECIALIST, CATALOG_SPECIALIST, PRICING_SPECIALIST, ORDERS_SPECIALIST, VOUCHER_SPECIALIST, FULFILLMENT_SPECIALIST, PROCUREMENT_SPECIALIST, BILLING_SPECIALIST, PROJECT_MANAGER_SPECIALIST, registerCommerceSpecialists, inventorySkill, catalogSkill, pricingSkill, ordersSkill, voucherSkill, fulfillmentSkill, procurementSkill, billingSkill, projectManagerSkill } from './commerce-specialists.js';
export { defineSkill, defineTool, loadSkillsFrom } from './skill.js';
