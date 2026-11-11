/**
 * @agentos/runtime — portable skill library.
 *
 *     import { createSkillRuntime, defineSkill, defineTool } from './src/runtime/index.js';
 *
 *     const runtime = createSkillRuntime();
 *     runtime.use(defineSkill({
 *       name: 'weather',
 *       tools: [defineTool({
 *         name: 'forecast',
 *         description: 'Read a forecast',
 *         handler: async () => ({ summary: 'clear' }),
 *       })],
 *       match: (input) => /weather/i.test(String(input)) ? { tool: 'forecast', args: {} } : null,
 *     }));
 *     await runtime.run('what is the weather');
 *
 * Production orchestration is AgentRuntime in src/core/agentRuntime.js.
 * This module does not create a second production loop.
 */

export { SpecialistRegistry } from './specialist-registry.js';
export {
  INVENTORY_SPECIALIST,
  CATALOG_SPECIALIST,
  PRICING_SPECIALIST,
  ORDERS_SPECIALIST,
  VOUCHER_SPECIALIST,
  FULFILLMENT_SPECIALIST,
  PROCUREMENT_SPECIALIST,
  BILLING_SPECIALIST,
  PROJECT_MANAGER_SPECIALIST,
  registerCommerceSpecialists,
  inventorySkill,
  catalogSkill,
  pricingSkill,
  ordersSkill,
  voucherSkill,
  fulfillmentSkill,
  procurementSkill,
  billingSkill,
  projectManagerSkill,
} from './commerce-specialists.js';
export { defineSkill, defineTool, loadSkillsFrom, discoverSkillMetadata } from './skill.js';
export { createSkillRuntime } from './skill-runtime.js';
