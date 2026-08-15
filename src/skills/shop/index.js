import { BaseSkill } from '../base.js';
import * as shop from '../../core/shop.js';
import { getCourierGateway } from '../../core/courier-gateway.js';

class ShopSkill extends BaseSkill {
  static id = 'shop';
  static name = 'Shop';
  static description = 'Server-authoritative product catalog, cart, and checkout';

  static getTools() {
    return {
      'shop.list_products': {
        risk: 'low',
        description: 'List active products, optionally filtered by category or search',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Product category to filter by' },
            search: { type: 'string', description: 'Free-text search' }
          },
          required: []
        }
      },
      'shop.list_payment_methods': {
        risk: 'low',
        description: 'List payment methods configured for the caller and device/country context',
        parameters: {
          type: 'object',
          properties: {
            country: { type: 'string', description: 'Optional ISO country code; omitted means provider/configuration default' },
            device: { type: 'string', default: 'mobile' }
          },
          required: []
        }
      },
      'shop.get_capabilities': {
        risk: 'low',
        description: 'Describe shopping actions allowed by the caller role',
        parameters: { type: 'object', properties: {}, required: [] }
      },
      'shop.get_product': {
        risk: 'low',
        description: 'Get a single product by ID, name, or slug',
        parameters: {
          type: 'object',
          properties: { productRef: { type: 'string', description: 'Product ID, name, or slug' } },
          required: ['productRef']
        }
      },
      'shop.view_cart': {
        risk: 'low',
        description: 'View the current cart for this channel',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            channelId: { type: 'string' }
          },
          required: ['platform', 'channelId']
        }
      },
      'shop.add_to_cart': {
        risk: 'low',
        description: 'Add a product to the cart',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            channelId: { type: 'string' },
            productRef: { type: 'string', description: 'Product ID, name, or slug' },
            size: { type: 'string' },
            qty: { type: 'number', default: 1 }
          },
          required: ['platform', 'channelId', 'productRef']
        }
      },
      'shop.remove_from_cart': {
        risk: 'low',
        description: 'Remove an item from the cart',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            channelId: { type: 'string' },
            keyOrProductId: { type: 'string' }
          },
          required: ['platform', 'channelId', 'keyOrProductId']
        }
      },
      'shop.clear_cart': {
        risk: 'low',
        description: 'Empty the cart entirely',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            channelId: { type: 'string' }
          },
          required: ['platform', 'channelId']
        }
      },
      'shop.checkout': {
        risk: 'medium',
        description: 'Close the sale — atomic stock decrement, order + invoice creation',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            channelId: { type: 'string' },
            uid: { type: 'string', description: "Buyer's user ID; omit for guest cash-on-delivery" },
            address: { type: 'object' },
            payMethod: { type: 'string', description: 'An ID returned by shop.list_payment_methods; do not assume a fixed provider list' }
          },
          required: ['platform', 'channelId']
        }
      },
      'shop.create_shipment': {
        risk: 'medium',
        description: 'Book a real shipment for an order with a courier provider (dhl, pargo, courier_guy)',
        parameters: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
            provider: { type: 'string', description: 'dhl, pargo, or courier_guy' }
          },
          required: ['orderId', 'provider']
        }
      },
      'shop.track_shipment': {
        risk: 'low',
        description: "Get live courier tracking status for an order's shipment",
        parameters: {
          type: 'object',
          properties: { orderId: { type: 'string' } },
          required: ['orderId']
        }
      },
      'shop.list_couriers': {
        risk: 'low',
        description: 'List available courier providers and whether each is configured',
        parameters: { type: 'object', properties: {}, required: [] }
      },
      'shop.submit_review': {
        risk: 'low',
        description: 'Submit a 1-5 star review for a product the caller has ordered',
        parameters: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            rating: { type: 'number', description: 'Whole number 1-5' },
            comment: { type: 'string' }
          },
          required: ['productId', 'rating']
        }
      },
      'shop.list_reviews': {
        risk: 'low',
        description: 'Get recent reviews for a product',
        parameters: {
          type: 'object',
          properties: { productId: { type: 'string' }, limit: { type: 'number', default: 5 } },
          required: ['productId']
        }
      },
      'shop.related_products': {
        risk: 'low',
        description: 'Get other active products in the same category, for "you might also like" suggestions',
        parameters: {
          type: 'object',
          properties: { productRef: { type: 'string' }, limit: { type: 'number', default: 3 } },
          required: ['productRef']
        }
      }
    };
  }

  async execute(toolName, args, ctx) {
    args = args || {};
    switch (toolName) {
      case 'shop.list_products': {
        const items = await shop.listProducts({ category: args.category, search: args.search });
        return items.map((p) => ({ ...p, url: shop.productUrl(p.id) }));
      }
      case 'shop.list_payment_methods': {
        const uid = ctx?.userId || args.uid || null;
        return shop.getPaymentMethods({
          country: args.country || ctx?.country || null,
          device: args.device || ctx?.device || 'mobile',
          uid,
          config: ctx?.paymentConfig || {},
        });
      }
      case 'shop.get_capabilities': {
        const roles = new Set([...(ctx?.roles || []), ctx?.role].filter(Boolean).map((role) => String(role).toLowerCase()));
        const isAdmin = roles.has('admin') || roles.has('owner') || roles.has('operator');
        return {
          roles: [...roles],
          canBrowse: true,
          canPurchase: true,
          canReview: Boolean(ctx?.userId),
          canManageShipments: isAdmin,
          canManageCatalog: isAdmin,
        };
      }
      case 'shop.get_product': {
        const p = await shop.getProduct(args.productRef);
        return p ? { ...p, url: shop.productUrl(p.id) } : p;
      }
      case 'shop.view_cart':
        return shop.getCart(args.platform, args.channelId);
      case 'shop.add_to_cart':
        return shop.addToCart(args.platform, args.channelId, args.productRef, { size: args.size, qty: args.qty || 1 });
      case 'shop.remove_from_cart':
        return shop.removeFromCart(args.platform, args.channelId, args.keyOrProductId);
      case 'shop.clear_cart':
        return shop.clearCart(args.platform, args.channelId);
      case 'shop.checkout': {
        // Prefer the authenticated caller's uid over any client-supplied uid —
        // a chat user must not be able to check out "as" someone else's balance.
        const uid = ctx?.userId || args.uid;
        this.logger.warn(`SHOP CHECKOUT ${args.platform}:${args.channelId} uid=${uid}`);
        const order = await shop.checkout(args.platform, args.channelId, { uid, address: args.address, payMethod: args.payMethod });
        return { ...order, url: shop.orderUrl(order.orderId) };
      }
      case 'shop.create_shipment':
        return shop.createShipment(args.orderId, args.provider);
      case 'shop.track_shipment':
        return shop.trackShipment(args.orderId);
      case 'shop.list_couriers': {
        return getCourierGateway().getAvailableProviders();
      }
      case 'shop.submit_review': {
        const uid = ctx?.userId;
        return shop.submitReview(args.productId, uid, { rating: args.rating, comment: args.comment });
      }
      case 'shop.list_reviews':
        return shop.getReviews(args.productId, args.limit || 5);
      case 'shop.related_products': {
        const p = await shop.getProduct(args.productRef);
        if (!p) throw new Error(`Product "${args.productRef}" not found.`);
        const items = await shop.relatedProducts(p, args.limit || 3);
        return items.map((r) => ({ ...r, url: shop.productUrl(r.id) }));
      }
      default:
        throw new Error(`Unknown tool ${toolName}`);
    }
  }
}

export default ShopSkill;
