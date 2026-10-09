/* ==========================================================
   17.shop.js — client logic for shop.html / product.html / order.html
   ========================================================== */
'use strict';

const Shop = {
    PLATFORM: 'web',
    channelId() {
        let id = localStorage.getItem('shop_channel_id');
        if (!id) { id = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('shop_channel_id', id); }
        return id;
    },
    idFromPath() { const parts = window.location.pathname.split('/').filter(Boolean); return parts[parts.length - 1] || null; },
    money(n) { return '$' + Number(n || 0).toFixed(2); },
    async listProducts(params = {}) { const qs = new URLSearchParams(params).toString(); const r = await ApiClient.fetch(`/api/v1/shop/products${qs ? '?' + qs : ''}`); return r.data; },
    async getProduct(id) { const r = await ApiClient.fetch(`/api/v1/shop/products/${encodeURIComponent(id)}`); return r.data; },
    async getCart() { const r = await ApiClient.fetch(`/api/v1/shop/cart?platform=${this.PLATFORM}&channelId=${this.channelId()}`); return r.data; },
    async addToCart(productRef, { size, qty } = {}) { const r = await ApiClient.fetch('/api/v1/shop/cart/add', { method: 'POST', body: JSON.stringify({ platform: this.PLATFORM, channelId: this.channelId(), productRef, size, qty }) }); return r.data; },
    async removeFromCart(keyOrProductId) { const r = await ApiClient.fetch('/api/v1/shop/cart/remove', { method: 'POST', body: JSON.stringify({ platform: this.PLATFORM, channelId: this.channelId(), keyOrProductId }) }); return r.data; },
    async checkout(address, payMethod) { const r = await ApiClient.fetch('/api/v1/shop/checkout', { method: 'POST', body: JSON.stringify({ platform: this.PLATFORM, channelId: this.channelId(), address, payMethod }) }); return r.data; },
    async getOrder(id) { const r = await ApiClient.fetch(`/api/v1/shop/orders/${encodeURIComponent(id)}`); return r.data; },
    async downloadOrderPdf(id, filename) { const blob = await ApiClient.fetchBlob(`/api/v1/shop/orders/${encodeURIComponent(id)}/pdf`); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename || `${id}.pdf`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
};

function shopText(value) { return value == null ? '' : String(value); }
function shopEl(tag, text, className) { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = shopText(text); return el; }
function shopError(container, message) { container.replaceChildren(shopEl('p', message, 'empty')); }

async function renderShopPage() {
    const grid = document.getElementById('shop-grid'); if (!grid) return;
    try {
        const products = await Shop.listProducts();
        if (!products.length) { grid.replaceChildren(shopEl('p', 'No products yet.', 'empty')); return; }
        const fragment = document.createDocumentFragment();
        products.forEach(p => {
            const card = shopEl('a', null, 'product-card');
            card.href = '/product/' + encodeURIComponent(p.id);
            card.append(shopEl('div', p.name, 'product-name'), shopEl('div', Shop.money(p.price), 'product-price'), shopEl('div', p.stock > 0 ? p.stock + ' in stock' : 'Sold out', 'product-stock'));
            fragment.appendChild(card);
        });
        grid.replaceChildren(fragment);
    } catch (e) { shopError(grid, 'Failed to load products: ' + shopText(e && e.message)); }
}

async function renderProductPage() {
    const container = document.getElementById('product-detail'); if (!container) return;
    try {
        const p = await Shop.getProduct(Shop.idFromPath());
        if (!p) { shopError(container, 'Product not found.'); return; }
        container.replaceChildren();
        container.append(shopEl('h1', p.name), shopEl('div', Shop.money(p.price), 'product-price'), shopEl('p', p.description || ''), shopEl('div', p.stock > 0 ? p.stock + ' in stock' : 'Sold out', 'product-stock'));
        if (Array.isArray(p.sizes) && p.sizes.length) {
            const select = document.createElement('select'); select.id = 'size-select';
            p.sizes.forEach(s => { const option = shopEl('option', s); option.value = shopText(s); select.appendChild(option); });
            container.appendChild(select);
        }
        const qty = document.createElement('input'); qty.id = 'qty-input'; qty.type = 'number'; qty.value = '1'; qty.min = '1'; qty.max = String(p.stock || 1); container.appendChild(qty);
        const button = shopEl('button', 'Add to cart'); button.id = 'add-to-cart-btn'; button.disabled = !(p.stock > 0); container.appendChild(button);
        const status = shopEl('div', null); status.id = 'add-status'; container.appendChild(status);
        button.addEventListener('click', async () => { try { await Shop.addToCart(p.id, { size: document.getElementById('size-select')?.value, qty: parseInt(qty.value, 10) || 1 }); status.textContent = 'Added to cart.'; } catch (e) { status.textContent = 'Error: ' + shopText(e && e.message); } });
    } catch (e) { shopError(container, 'Failed to load product: ' + shopText(e && e.message)); }
}

async function renderOrderPage() {
    const container = document.getElementById('order-detail'); if (!container) return;
    try {
        const order = await Shop.getOrder(Shop.idFromPath());
        container.replaceChildren(shopEl('h1', 'Order ' + (order.invoiceNumber || order.id)), shopEl('div', order.status, 'order-status'));
        const list = shopEl('ul', null, 'order-items');
        (order.items || []).forEach(i => list.appendChild(shopEl('li', `${i.qty} × ${i.name}${i.size ? ' (' + i.size + ')' : ''} — ${Shop.money(i.price * i.qty)}`)));
        container.append(list, shopEl('div', 'Total: ' + Shop.money(order.total), 'order-total'));
        const button = shopEl('button', order.status === 'paid' ? 'Download Receipt (PDF)' : 'Download Invoice (PDF)'); button.id = 'download-pdf-btn'; container.appendChild(button);
        const status = shopEl('div', null); status.id = 'pdf-status'; container.appendChild(status);
        button.addEventListener('click', async () => { try { await Shop.downloadOrderPdf(Shop.idFromPath(), `${order.invoiceNumber || order.id}.pdf`); } catch (e) { status.textContent = 'Error: ' + shopText(e && e.message); } });
    } catch (e) { shopError(container, shopText(e && e.message)); }
}

document.addEventListener('DOMContentLoaded', () => { renderShopPage(); renderProductPage(); renderOrderPage(); });
