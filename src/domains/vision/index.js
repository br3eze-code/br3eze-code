import BaseDomain from '../BaseDomain.js';
import { logger } from '../../core/logger.js';

function text(value) {
  return String(value || '').toLowerCase();
}

function productScore(product, seedProduct = {}, context = {}) {
  let score = 0;
  if (product.category && seedProduct.category && product.category === seedProduct.category) score += 40;
  if (product.brand && seedProduct.brand && product.brand === seedProduct.brand) score += 15;
  const seedPrice = Number(seedProduct.price);
  const price = Number(product.price);
  if (Number.isFinite(seedPrice) && Number.isFinite(price) && seedPrice > 0) {
    score += Math.max(0, 20 - Math.round(Math.abs(seedPrice - price) / seedPrice * 20));
  }
  if (Number(product.stock || 0) > 0) score += 10;
  const preference = text(context.preference || context.preferences || context.search);
  if (preference) {
    const haystack = `${product.name || ''} ${product.description || ''} ${product.category || ''} ${product.brand || ''}`.toLowerCase();
    if (haystack.includes(preference)) score += 25;
  }
  return score;
}

class VisionDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'vision';
    this.capabilities = ['image-generation', 'image-editing', 'product-recommendation'];

    this.registerTool({
      name: 'generateImage',
      description: 'Generate images using a configured image provider',
      execute: async (prompt, provider = 'openai', options = {}) => {
        logger.info(`[VisionDomain] Generating image via ${provider}`);
        if (provider === 'openai') return { success: true, url: 'https://cdn.br3eze.africa/vision/openai_mock.png', provider };
        if (provider === 'nanobanana') return { success: true, url: 'https://cdn.br3eze.africa/vision/nanobanana_mock.png', provider };
        return { success: false, error: 'Unsupported image provider' };
      }
    });

    this.registerTool({
      name: 'editImage',
      description: 'Edit an existing image or apply a style transfer',
      execute: async (imageUrl, prompt) => {
        logger.info(`[VisionDomain] Editing image ${imageUrl}`);
        return { success: true, url: 'https://cdn.br3eze.africa/vision/edited_mock.png', prompt };
      }
    });

    this.registerTool({
      name: 'recommendProducts',
      description: 'Rank already-authorized product candidates for a user context without exposing private location data',
      risk: 'low',
      passContext: true,
      parameters: {
        type: 'object',
        properties: {
          products: { type: 'array' },
          seedProduct: { type: 'object' },
          limit: { type: 'number', default: 3 },
          preference: { type: 'string' }
        },
        required: ['products']
      },
      execute: async ({ products = [], seedProduct = {}, limit = 3, preference } = {}, context = {}) => {
        const safeProducts = Array.isArray(products) ? products.filter((product) => product && product.id) : [];
        const ranked = safeProducts
          .map((product) => ({ ...product, recommendationScore: productScore(product, seedProduct, { ...context, preference }) }))
          .sort((left, right) => right.recommendationScore - left.recommendationScore || String(left.name || '').localeCompare(String(right.name || '')))
          .slice(0, Math.max(1, Math.min(Number(limit) || 3, 10)));
        return {
          success: true,
          products: ranked,
          basis: 'category, brand, price proximity, availability, and explicit preference',
          scope: { tenantId: context.tenantId || null, domain: context.domain || null, siteId: context.siteId || null }
        };
      }
    });
  }
}

export default VisionDomain;
