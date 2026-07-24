// ==========================================
// AGENTOS SHOP COMMAND
// Catalog inspection — @clack/prompts edition
// ==========================================

'use strict';

const fs = require('fs');
const { CONFIG_PATH } = require('../../core/config');

module.exports = (program) => {
  const shop = program
    .command('shop')
    .description('Browse the shop catalog');

  // ── Resolve skill (lazy, throws on bad config — callers already catch) ────
  const getSkill = () => {
    if (!fs.existsSync(CONFIG_PATH)) {
      throw new Error('No configuration found — run: agentos onboard');
    }
    const ShopSkill = require('../../skills/shop/index.js');
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return new ShopSkill(config, console, {});
  };

  // ── shop list ─────────────────────────────────────────────────────────────
  shop
    .command('list')
    .description('List products in the catalog')
    .option('-c, --category <cat>', 'Filter by category')
    .option('-s, --search <query>', 'Free-text search')
    .action(async (options) => {
      const { intro, outro, spinner, note, log } = await import('@clack/prompts');
      intro('🛍️  Shop Catalog');
      const s = spinner();
      s.start('Fetching products…');
      try {
        const skill = getSkill();
        const products = await skill.execute('shop.list_products', {
          category: options.category,
          search: options.search,
        });
        s.stop(`${products.length} product(s) found`);
        if (!products.length) {
          note('No products found.', '🛍️  Catalog');
        } else {
          const lines = products.map(p =>
            `${p.id}  ${p.name} — $${p.price}  (${p.stock > 0 ? `${p.stock} in stock` : 'sold out'})`
          );
          note(lines.join('\n'), '📋 Products');
        }
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });

  // ── shop product <ref> ───────────────────────────────────────────────────
  shop
    .command('product <ref>')
    .description('Get a single product by ID, name, or slug')
    .action(async (ref) => {
      const { intro, outro, spinner, note, log } = await import('@clack/prompts');
      intro('🛍️  Product Detail');
      const s = spinner();
      s.start(`Looking up "${ref}"…`);
      try {
        const skill = getSkill();
        const product = await skill.execute('shop.get_product', { productRef: ref });
        if (!product) {
          s.stop('Not found');
          note(`No product matching "${ref}".`, '🛍️  Product');
        } else {
          s.stop('Found');
          note(JSON.stringify(product, null, 2), `🛍️  ${product.name}`);
        }
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });
};
