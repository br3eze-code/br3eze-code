/**
 * PDF invoice rendering — thin bridge between a checkout result (see
 * src/core/shop.js `checkout()`) and the skills/nanopdf HTML-to-PDF skill.
 *
 * Best-effort by design: an order must never fail or be blocked just because
 * a decorative PDF couldn't be rendered (missing Chromium in this
 * environment, template error, etc.) — callers get `null` back and should
 * carry on with a text-only confirmation.
 */
'use strict';

const path = require('path');
const fs = require('fs').promises;
const logger = require('./logger').logger || require('./logger');

let _skillPromise = null;

// One shared skill instance (and its one headless Chromium) reused across
// every invoice — launching a browser per PDF would be slow and wasteful.
// The module itself exports an already-constructed singleton, not a class.
async function _getSkill() {
    if (!_skillPromise) {
        _skillPromise = (async () => {
            const skill = require('../../skills/nanopdf/index.js');
            await skill.initialize();
            return skill;
        })();
    }
    return _skillPromise;
}

function _money(n) {
    return Number(n || 0).toFixed(2);
}

/**
 * @param {object} invoice
 * @param {string} invoice.invoiceNumber
 * @param {Array<object>} invoice.items - cart-item shape from shop.js: { name, price, qty, size }
 *   (also accepts the Firestore invoice-doc shape: { description, unitPrice, qty, amount })
 * @param {number} invoice.subtotal
 * @param {number} invoice.shipping
 * @param {number} invoice.total
 * @param {object} [invoice.billingAddress] - { name, street, city, country }
 * @returns {Promise<Buffer|null>} the rendered PDF, or null if unavailable
 */
async function renderInvoicePdf(invoice) {
    try {
        const skill = await _getSkill();
        if (!skill.browser) {
            logger.warn(`[Invoicing] No PDF browser available — skipping PDF for invoice ${invoice.invoiceNumber}`);
            return null;
        }
        const addr = invoice.billingAddress || {};
        const items = (invoice.items || []).map((i) => {
            const qty = i.qty ?? i.quantity ?? 1;
            const unitPrice = i.price ?? i.unitPrice ?? 0;
            return {
                description: i.description || `${i.name}${i.size ? ` (${i.size})` : ''}`,
                quantity: qty,
                price: _money(unitPrice),
                total: _money(i.amount ?? qty * unitPrice),
            };
        });
        const data = {
            companyName: process.env.COMPANY_NAME || 'Power Connect',
            invoiceNumber: invoice.invoiceNumber,
            customerName: addr.name || 'Customer',
            customerAddress: [addr.street, addr.city, addr.country].filter(Boolean).join(', ') || '—',
            date: new Date().toLocaleDateString(),
            dueDate: new Date().toLocaleDateString(),
            items,
            totalAmount: _money(invoice.total),
        };
        const result = await skill.createPDF({ template: 'invoice', data });
        if (!result || !result.success) return null;
        return await fs.readFile(path.join(skill.cacheDir, result.filename));
    } catch (e) {
        logger.warn(`[Invoicing] PDF generation failed for ${invoice.invoiceNumber}: ${e.message}`);
        return null;
    }
}

module.exports = { renderInvoicePdf };
