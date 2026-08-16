import { assertBotContext, CONTEXT_TYPES, normalizeBotContext } from './bot.ai.js';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function scoped(item, context) {
  if (!item || typeof item !== 'object') return false;
  if (item.tenantId && item.tenantId !== context.tenantId) return false;
  if (item.siteId && context.siteId && item.siteId !== context.siteId) return false;
  if (Array.isArray(context.authorizedSiteIds) && context.authorizedSiteIds.length && item.siteId && !context.authorizedSiteIds.includes(item.siteId)) return false;
  return true;
}

function result(domain, context, metrics, evidence, risks, nextActions) {
  return {
    domain,
    contextType: CONTEXT_TYPES.ANALYSIS,
    requestId: context.requestId,
    traceId: context.traceId,
    scope: { tenantId: context.tenantId, siteId: context.siteId, domain },
    metrics,
    evidence,
    risks,
    nextActions,
    generatedAt: new Date().toISOString(),
  };
}

export class CctvDataAnalyst {
  analyze(input = {}, rawContext = {}) {
    const context = normalizeBotContext({ ...rawContext, domain: 'cctv' }, { contextType: CONTEXT_TYPES.ANALYSIS });
    assertBotContext(context, { requireIdentity: true, requireTenant: true });
    const devices = (Array.isArray(input.devices) ? input.devices : []).filter((item) => scoped(item, context));
    const channels = (Array.isArray(input.channels) ? input.channels : []).filter((item) => scoped(item, context));
    const events = (Array.isArray(input.events) ? input.events : []).filter((item) => scoped(item, context));
    const online = devices.filter((item) => item.online === true || String(item.status).toLowerCase() === 'online').length;
    const healthRate = devices.length ? online / devices.length : null;
    const highSeverity = events.filter((item) => ['high', 'critical'].includes(String(item.severity).toLowerCase())).length;
    const evidence = [
      `${devices.length} authorized CCTV devices in scope`,
      `${channels.length} authorized channels in scope`,
      `${events.length} authorized events in the analysis window`,
    ];
    const risks = [];
    if (healthRate !== null && healthRate < 0.95) risks.push({ code: 'DEVICE_HEALTH_DEGRADED', severity: 'medium', count: devices.length - online });
    if (highSeverity) risks.push({ code: 'HIGH_SEVERITY_EVENTS', severity: 'high', count: highSeverity });
    const nextActions = [];
    if (healthRate !== null && healthRate < 0.95) nextActions.push({ actionId: 'cctv.device.health', requiresApproval: false });
    if (highSeverity) nextActions.push({ actionId: 'cctv.events.summarize', requiresApproval: false });
    return result('cctv', context, {
      deviceCount: devices.length,
      onlineDeviceCount: online,
      healthRate,
      channelCount: channels.length,
      eventCount: events.length,
      highSeverityEventCount: highSeverity,
      uptimeAverage: devices.length ? devices.reduce((sum, item) => sum + finite(item.uptimePercent, 0), 0) / devices.length : null,
    }, evidence, risks, nextActions);
  }
}

export class ShoppingDataAnalyst {
  analyze(input = {}, rawContext = {}) {
    const context = normalizeBotContext({ ...rawContext, domain: 'shopping' }, { contextType: CONTEXT_TYPES.ANALYSIS });
    assertBotContext(context, { requireIdentity: true, requireTenant: true });
    const products = (Array.isArray(input.products) ? input.products : []).filter((item) => scoped(item, context));
    const orders = (Array.isArray(input.orders) ? input.orders : []).filter((item) => scoped(item, context));
    const carts = (Array.isArray(input.carts) ? input.carts : []).filter((item) => scoped(item, context));
    const soldOut = products.filter((item) => finite(item.stock, 1) <= 0).length;
    const paidOrders = orders.filter((item) => ['paid', 'settled', 'complete', 'completed'].includes(String(item.status || item.paymentStatus).toLowerCase()));
    const grossRevenue = paidOrders.reduce((sum, item) => sum + finite(item.total ?? item.amount, 0), 0);
    const evidence = [
      `${products.length} authorized products in scope`,
      `${orders.length} authorized orders in the analysis window`,
      `${carts.length} authorized carts in the analysis window`,
    ];
    const risks = [];
    if (soldOut) risks.push({ code: 'STOCKOUTS', severity: 'medium', count: soldOut });
    if (carts.length && orders.length && carts.length > orders.length * 2) risks.push({ code: 'CART_CONVERSION_GAP', severity: 'medium' });
    const nextActions = [];
    if (soldOut) nextActions.push({ actionId: 'shop.inventory.review', requiresApproval: false });
    if (risks.some((risk) => risk.code === 'CART_CONVERSION_GAP')) nextActions.push({ actionId: 'shop.cart.analyze', requiresApproval: false });
    return result('shopping', context, {
      productCount: products.length,
      soldOutProductCount: soldOut,
      orderCount: orders.length,
      paidOrderCount: paidOrders.length,
      grossRevenue,
      cartCount: carts.length,
      conversionRate: carts.length ? paidOrders.length / carts.length : null,
    }, evidence, risks, nextActions);
  }
}

export class DataAnalystRegistry {
  constructor() {
    this.analysts = new Map([
      ['cctv', new CctvDataAnalyst()],
      ['shopping', new ShoppingDataAnalyst()],
      ['shop', new ShoppingDataAnalyst()],
    ]);
  }

  register(domain, analyst) {
    if (!domain || !analyst || typeof analyst.analyze !== 'function') throw new TypeError('A domain and analyst with analyze() are required');
    this.analysts.set(String(domain).toLowerCase(), analyst);
    return this;
  }

  analyze(domain, input, context) {
    const analyst = this.analysts.get(String(domain || '').toLowerCase());
    if (!analyst) throw Object.assign(new Error(`No analyst registered for domain: ${domain}`), { code: 'ANALYST_NOT_FOUND', status: 404 });
    return analyst.analyze(input, context);
  }
}

export default { CctvDataAnalyst, ShoppingDataAnalyst, DataAnalystRegistry };
