import * as shop from './shop.js';
import { buildExecutionContext } from './execution-context.js';
import { executeCheckout } from '../commerce/acp/checkout-orchestrator.js';

function platformFor(channel) {
  return String(channel?.constructor?.name || 'channel').replace(/Channel$/, '').toLowerCase();
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function requestIdFor(message = {}) {
  return message.requestId
    || message.messageId
    || message.eventId
    || message.id
    || message.key?.id
    || message.message?.id
    || null;
}

function channelScope(context) {
  return context.scope || {
    tenantId: context.tenantId || null,
    siteId: context.siteId || null,
    domain: context.domain || null,
  };
}

function navigationButtons(extra = []) {
  return [
    ...extra,
    { label: '🛒 Cart', action: 'shop:cart', data: { action: 'cart' } },
    { label: '✖ Cancel', action: 'nav:cancel', data: { action: 'cancel' } },
  ].slice(0, 3);
}

function productButtons(product) {
  const buttons = [];
  if (Array.isArray(product.sizes) && product.sizes.length === 1) {
    buttons.push({
      label: `Add ${product.sizes[0]}`,
      action: `shop:add:${product.id}:${product.sizes[0]}`,
      data: { action: 'add', productRef: product.id, size: product.sizes[0] },
    });
  } else if (!Array.isArray(product.sizes) || product.sizes.length === 0) {
    buttons.push({
      label: 'Add to cart',
      action: `shop:add:${product.id}`,
      data: { action: 'add', productRef: product.id },
    });
  }
  return navigationButtons(buttons);
}

function productText(product) {
  const sizes = Array.isArray(product.sizes) && product.sizes.length
    ? `\nSizes: ${product.sizes.join(', ')}`
    : '';
  return `🛍️ *${product.name}*\n\n${product.description || 'No description available.'}\n\nPrice: ${money(product.price)}\nStock: ${product.stock ?? 'available'}${sizes}`;
}

async function send(channel, jid, text, buttons = []) {
  return channel.send(jid, buttons.length ? { text, buttons } : text);
}

/**
 * Shared shopping command for channels that do not have a dedicated shop UI.
 * It deliberately uses the same core shop service as Telegram and WhatsApp.
 *
 * Commerce mutations are scoped to the execution context. Checkout also uses
 * the inbound channel event/request id as its idempotency key so a transport
 * retry cannot create a second order, while a genuinely new message can make
 * a new purchase.
 */
export async function handleShop(channel, jid, msg = {}, args = []) {
  const platform = platformFor(channel);
  const context = buildExecutionContext({
    ...msg,
    message: msg,
    userId: msg._uid || msg.userId || jid,
    platformId: jid,
    channel: platform,
    userDoc: msg.userDoc,
  });
  const scope = channelScope(context);
  const action = String(args[1] || 'list').toLowerCase();

  try {
    if (action === 'list' || action === 'catalog') {
      const products = await shop.listProducts({ search: args.slice(2).join(' ') || undefined, scope });
      if (!products.length) return send(channel, jid, '🛍️ No products matched your search. Try `/shop list`.', navigationButtons());
      const shown = products.slice(0, 8);
      const lines = shown.map((p, i) => `${i + 1}. *${p.name}* — ${money(p.price)}${p.stock === 0 ? ' — sold out' : ''}`);
      const buttons = shown.slice(0, 2).map((p) => ({
        label: p.name.slice(0, 30),
        action: `shop:product:${p.id}`,
        data: { action: 'product', productRef: p.id },
      }));
      return send(channel, jid, `🛍️ *Catalog*\n\n${lines.join('\n')}\n\nUse \`/shop product <id>\` for details or \`/shop add <id>\` to add an item.`, navigationButtons(buttons));
    }

    if (action === 'product' || action === 'view') {
      const product = await shop.getProduct(args[2], scope);
      if (!product) return send(channel, jid, `❌ Product not found: ${args[2] || '(missing id)'}`, navigationButtons());
      return send(channel, jid, productText(product), productButtons(product));
    }

    if (action === 'add' || action === 'buy') {
      const product = await shop.getProduct(args[2], scope);
      if (!product) return send(channel, jid, `❌ Product not found: ${args[2] || '(missing id)'}`, navigationButtons());
      let size = args[3] || null;
      if (Array.isArray(product.sizes) && product.sizes.length > 1 && !size) {
        return send(channel, jid, `📏 Choose a size for *${product.name}*: ${product.sizes.join(', ')}\nUse \`/shop add ${product.id} <size>\`.`, navigationButtons());
      }
      if (size && Array.isArray(product.sizes) && !product.sizes.includes(size)) {
        return send(channel, jid, `❌ Invalid size. Choose: ${product.sizes.join(', ')}`, navigationButtons());
      }
      const result = await shop.addToCart(platform, context.channelId || jid, product.id, { size, scope });
      return send(channel, jid, `✅ Added *${result.product.name}*${size ? ` (${size})` : ''} to your cart.`, navigationButtons([
        { label: 'Checkout', action: 'shop:checkout', data: { action: 'checkout' } },
        { label: 'Continue shopping', action: 'shop:list', data: { action: 'list' } },
      ]));
    }

    if (action === 'payments' || action === 'payment' || action === 'methods') {
      const methods = shop.getPaymentMethods({ uid: context.userId, country: context.country, device: context.device === 'unknown' ? 'mobile' : context.device, config: context.paymentConfig });
      const lines = methods.map((method) => `• *${method.name}* — \`${method.id}\`${method.description ? `: ${method.description}` : ''}`);
      return send(channel, jid, `💳 *Available payment methods*\n\n${lines.join('\n')}\n\nCheckout with: /shop checkout <method-id>.`, navigationButtons());
    }

    if (action === 'capabilities' || action === 'roles') {
      const roles = new Set([...(msg.roles || []), msg.role].filter(Boolean).map((role) => String(role).toLowerCase()));
      const admin = roles.has('admin') || roles.has('owner') || roles.has('operator');
      return send(channel, jid, `🔐 *Shopping capabilities*\\n\\nRoles: ${[...roles].join(', ') || 'guest'}\\nBrowse: ✅\\nPurchase: ✅\\nReviews: ${context.userId ? '✅' : '❌'}\\nShipment management: ${admin ? '✅' : '❌'}\\nCatalog management: ${admin ? '✅' : '❌'}`, navigationButtons());
    }

    if (action === 'cart') {
      const items = await shop.getCart(platform, context.channelId || jid, scope);
      if (!items.length) return send(channel, jid, '🛒 Your cart is empty.', navigationButtons([
        { label: 'Browse catalog', action: 'shop:list', data: { action: 'list' } },
      ]));
      const total = shop.subtotal(items);
      const lines = items.map((i) => `• ${i.name}${i.size ? ` (${i.size})` : ''} × ${i.qty} — ${money(i.price * i.qty)}`);
      return send(channel, jid, `🛒 *Your cart*\n\n${lines.join('\n')}\n\nSubtotal: ${money(total)}\nShipping: ${money(shop.SHIPPING_FLAT)}\nTotal: ${money(total + shop.SHIPPING_FLAT)}`, navigationButtons([
        { label: 'Checkout', action: 'shop:checkout', data: { action: 'checkout' } },
      ]));
    }

    if (action === 'remove') {
      if (!args[2]) return send(channel, jid, 'Usage: `/shop remove <product-id-or-cart-key>`', navigationButtons());
      await shop.removeFromCart(platform, context.channelId || jid, args[2], scope);
      return send(channel, jid, '🗑️ Removed from cart.', navigationButtons([
        { label: 'View cart', action: 'shop:cart', data: { action: 'cart' } },
      ]));
    }

    if (action === 'checkout') {
      const payMethod = args[2] || 'cod';
      const methods = shop.getPaymentMethods({ uid: context.userId, country: context.country, device: context.device === 'unknown' ? 'mobile' : context.device, config: context.paymentConfig });
      if (!methods.some((method) => method.id === payMethod)) {
        return send(channel, jid, `❌ Payment method ${payMethod} is unavailable. Use /shop methods to see configured options.`, navigationButtons());
      }

      const requestId = requestIdFor(msg);
      if (!requestId) {
        return send(channel, jid, '❌ Checkout request id is missing. Please retry the checkout action.', navigationButtons());
      }

      const channelId = context.channelId || jid;
      const result = await executeCheckout({
        idempotencyKey: `channel-${platform}-${String(requestId)}`,
        merchantId: context.tenantId || context.userDoc?.tenantId || 'default',
        buyerId: context.userId,
        platform,
        channelId,
        address: context.address || {},
        payMethod,
        scope,
      });
      return send(channel, jid, `✅ *Order placed*\nInvoice: ${result.invoiceNumber}\nTotal: ${money(result.total)}\nPayment: ${result.payMethod}${result.replayed ? '\n↩️ Already processed — this was a retry.' : ''}`, navigationButtons([
        { label: 'Shop again', action: 'shop:list', data: { action: 'list' } },
      ]));
    }

    if (action === 'track') {
      if (!args[2]) return send(channel, jid, 'Usage: `/shop track <order-id>`', navigationButtons());
      const status = await shop.trackShipment(args[2], scope);
      return send(channel, jid, `📦 *Tracking*\nStatus: ${status.status}\n${status.location ? `Location: ${status.location}\n` : ''}${status.eta ? `ETA: ${status.eta}\n` : ''}${status.trackingUrl || ''}`, navigationButtons());
    }

    return send(channel, jid, '🛍️ Use `/shop list`, `/shop product <id>`, `/shop add <id> [size]`, `/shop cart`, `/shop methods`, `/shop roles`, `/shop remove <id>`, `/shop checkout <method-id>`, or `/shop track <order-id>`.', navigationButtons());
  } catch (error) {
    return send(channel, jid, `❌ Shopping error: ${error.message}`, navigationButtons());
  }
}

export { navigationButtons, productText, platformFor, requestIdFor };

export default { handleShop, navigationButtons, productText, platformFor, requestIdFor };

// Keep this module free of transport imports so it can be unit-tested without
// opening Discord, Slack, WhatsApp, or Telegram connections.
