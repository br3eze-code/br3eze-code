import { SpecialistRegistry } from './specialist-registry.js';
import inventorySkill from './skills/inventory.js';
import catalogSkill from './skills/catalog.js';
import pricingSkill from './skills/pricing.js';
import ordersSkill from './skills/orders.js';
import voucherSkill from './skills/voucher.js';
import fulfillmentSkill from './skills/fulfillment.js';
import procurementSkill from './skills/procurement.js';
import billingSkill from './skills/billing.js';
import projectManagerSkill from './skills/project-manager.js';

const descriptor = ({ id, role, name, description, tools, permissions, dependsOn = [], handoffsTo = [], ticketTypes }) => Object.freeze({
  id, role, name, label: name, domain: 'commerce', description,
  skills: [role], skillNames: [role], tools, permissions, dependsOn, handoffsTo, ticketTypes, handoffs: handoffsTo,
});

export const INVENTORY_SPECIALIST = descriptor({
  id: 'inventory-specialist', role: 'inventory', name: 'Inventory Specialist',
  description: 'Maintains scoped availability, reservations, reconciliation, and stock evidence.',
  tools: ['inventory.search', 'inventory.get', 'inventory.reserve', 'inventory.release', 'inventory.adjust', 'inventory.transfer', 'inventory.reconcile', 'inventory.lowStock'],
  permissions: ['inventory:read', 'inventory:write'], dependsOn: ['catalog'], handoffsTo: ['catalog', 'orders', 'procurement', 'fulfillment', 'project-manager'],
  ticketTypes: ['inventory-inquiry', 'reserve-stock', 'release-stock', 'adjust-stock', 'transfer-stock', 'reconcile-stock', 'replenishment-review'],
});

export const CATALOG_SPECIALIST = descriptor({
  id: 'catalog-specialist', role: 'catalog', name: 'Catalog Specialist',
  description: 'Owns versioned product, SKU, plan, offer, eligibility, and publication definitions.',
  tools: ['catalog.search', 'catalog.get', 'catalog.validate', 'catalog.publish'],
  permissions: ['catalog:read', 'catalog:write'], handoffsTo: ['pricing', 'inventory', 'orders', 'voucher', 'project-manager'],
  ticketTypes: ['product-inquiry', 'catalog-validation', 'catalog-publication'],
});

export const PRICING_SPECIALIST = descriptor({
  id: 'pricing-specialist', role: 'pricing', name: 'Pricing and Promotions Specialist',
  description: 'Calculates and governs versioned prices, discounts, taxes, credits, and promotions.',
  tools: ['pricing.calculate', 'pricing.validate', 'pricing.publish'], permissions: ['pricing:read', 'pricing:write'],
  dependsOn: ['catalog'], handoffsTo: ['orders', 'billing', 'project-manager'], ticketTypes: ['price-calculation', 'pricing-validation', 'pricing-publication'],
});

export const ORDERS_SPECIALIST = descriptor({
  id: 'orders-specialist', role: 'orders', name: 'Orders and Checkout Specialist',
  description: 'Owns idempotent cart, checkout, order state, amendments, and cancellations.',
  tools: ['orders.create', 'orders.get', 'orders.amend', 'orders.cancel'], permissions: ['orders:read', 'orders:write'],
  dependsOn: ['catalog', 'pricing', 'inventory'], handoffsTo: ['billing', 'fulfillment', 'project-manager'], ticketTypes: ['order-create', 'order-amend', 'order-cancel', 'checkout-validation'],
});

export const VOUCHER_SPECIALIST = descriptor({
  id: 'voucher-specialist', role: 'voucher', name: 'Voucher and Access Specialist',
  description: 'Owns scoped voucher issuance, redemption, eligibility, access plans, and revocation.',
  tools: ['voucher.issue', 'voucher.validate', 'voucher.redeem', 'voucher.revoke'], permissions: ['voucher:read', 'voucher:write'],
  dependsOn: ['catalog', 'billing'], handoffsTo: ['billing', 'project-manager'], ticketTypes: ['voucher-issue', 'voucher-validation', 'voucher-redemption', 'voucher-revocation'],
});

export const FULFILLMENT_SPECIALIST = descriptor({
  id: 'fulfillment-specialist', role: 'fulfillment', name: 'Fulfillment and Expeditor Specialist',
  description: 'Reconciles shipment evidence, delivery milestones, and fulfillment exceptions.',
  tools: ['fulfillment.track', 'fulfillment.reconcile', 'fulfillment.exception'], permissions: ['fulfillment:read', 'fulfillment:write'],
  dependsOn: ['orders', 'inventory', 'procurement'], handoffsTo: ['procurement', 'billing', 'project-manager'], ticketTypes: ['shipment-tracking', 'fulfillment-reconciliation', 'delivery-exception'],
});

export const PROCUREMENT_SPECIALIST = descriptor({
  id: 'procurement-specialist', role: 'procurement', name: 'Procurement Specialist',
  description: 'Coordinates evidenced supplier search, quote comparison, and purchase proposals.',
  tools: ['procurement.search', 'procurement.compare', 'procurement.propose'], permissions: ['procurement:read', 'procurement:write'],
  dependsOn: ['catalog', 'fulfillment'], handoffsTo: ['billing', 'project-manager'], ticketTypes: ['supplier-search', 'quote-comparison', 'purchase-proposal'],
});

export const BILLING_SPECIALIST = descriptor({
  id: 'billing-specialist', role: 'billing', name: 'Billing and Payments Specialist',
  description: 'Protects authorization, capture, refunds, credits, ledger, webhook, and reconciliation state.',
  tools: ['billing.authorize', 'billing.capture', 'billing.refund', 'billing.reconcile'], permissions: ['billing:read', 'billing:write', 'billing:reconcile'],
  dependsOn: ['pricing', 'orders', 'voucher'], handoffsTo: ['project-manager'], ticketTypes: ['payment-authorization', 'payment-capture', 'refund-request', 'billing-reconciliation'],
});

export const PROJECT_MANAGER_SPECIALIST = descriptor({
  id: 'project-manager-specialist', role: 'project-manager', name: 'Project Manager Specialist',
  description: 'Coordinates durable WBS packages, dependencies, risks, approvals, milestones, and closure.',
  tools: ['project.create', 'workpackage.create', 'workpackage.assign', 'dependency.check', 'risk.record', 'approval.request', 'milestone.update', 'project.close'],
  permissions: ['project:read', 'project:write', 'wbs:read', 'wbs:write', 'wbs:delegate', 'risk:write', 'approval:write'],
  dependsOn: ['catalog', 'inventory', 'pricing', 'orders', 'voucher', 'fulfillment', 'procurement', 'billing'], handoffsTo: ['catalog', 'inventory', 'pricing', 'orders', 'voucher', 'fulfillment', 'procurement', 'billing'],
  ticketTypes: ['project-plan', 'wbs-package', 'specialist-handoff', 'dependency-check', 'project-risk', 'approval-request', 'milestone-update', 'project-close'],
});

const SPECIALISTS = [INVENTORY_SPECIALIST, CATALOG_SPECIALIST, PRICING_SPECIALIST, ORDERS_SPECIALIST, VOUCHER_SPECIALIST, FULFILLMENT_SPECIALIST, PROCUREMENT_SPECIALIST, BILLING_SPECIALIST, PROJECT_MANAGER_SPECIALIST];

export function registerCommerceSpecialists(registry = new SpecialistRegistry()) {
  for (const specialist of SPECIALISTS) registry.register(specialist);
  return registry;
}

export { inventorySkill, catalogSkill, pricingSkill, ordersSkill, voucherSkill, fulfillmentSkill, procurementSkill, billingSkill, projectManagerSkill };
export default { ...Object.fromEntries(SPECIALISTS.map((specialist) => [specialist.role.toUpperCase(), specialist])), registerCommerceSpecialists, inventorySkill, catalogSkill, pricingSkill, ordersSkill, voucherSkill, fulfillmentSkill, procurementSkill, billingSkill, projectManagerSkill };
