/* ==========================================================
   17.shop.js — client logic for shop.html / product.html / order.html
   Depends on: 16.api.client.js (window.ApiClient)
   Guest cart identity persists across reloads via a stable
   localStorage-generated channelId, same pattern WebSocketChannel.js
   uses server-side for reconnect persistence.
   ========================================================== */

const Shop = {
    PLATFORM: 'web',

    channelId() {
        let id = localStorage.getItem('shop_channel_id');
        if (!id) {
            id = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('shop_channel_id', id);
        }
        return id;
    },

    idFromPath() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || null;
    },

    money(n) { return '$' + Number(n || 0).toFixed(2); },

    async listProducts(params = {}) {
        const qs = new URLSearchParams(params).toString();
        const r = await ApiClient.fetch(`/api/v1/shop/products${qs ? '?' + qs : ''}`);
        return r.data;
    },

    async getProduct(id) {
        const r = await ApiClient.fetch(`/api/v1/shop/products/${encodeURIComponent(id)}`);
        return r.data;
    },

    async getCart() {
        const r = await ApiClient.fetch(`/api/v1/shop/cart?platform=${this.PLATFORM}&channelId=${this.channelId()}`);
        return r.data;
    },

    async addToCart(productRef, { size, qty } = {}) {
        const r = await ApiClient.fetch('/api/v1/shop/cart/add', {
            method: 'POST',
            body: JSON.stringify({ platform: this.PLATFORM, channelId: this.channelId(), productRef, size, qty })
        });
        return r.data;
    },

    async removeFromCart(keyOrProductId) {
        const r = await ApiClient.fetch('/api/v1/shop/cart/remove', {
            method: 'POST',
            body: JSON.stringify({ platform: this.PLATFORM, channelId: this.channelId(), keyOrProductId })
        });
        return r.data;
    },

    async checkout(address, payMethod) {
        const r = await ApiClient.fetch('/api/v1/shop/checkout', {
            method: 'POST',
            body: JSON.stringify({ platform: this.PLATFORM, channelId: this.channelId(), address, payMethod })
        });
        return r.data;
    },

    async getOrder(id) {
        const r = await ApiClient.fetch(`/api/v1/shop/orders/${encodeURIComponent(id)}`);
        return r.data;
    },

    async downloadOrderPdf(id, filename) {
        const blob = await ApiClient.fetchBlob(`/api/v1/shop/orders/${encodeURIComponent(id)}/pdf`);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `${id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }
};

// ── shop.html: catalog grid ─────────────────────────────────
async function renderShopPage() {
    const grid = document.getElementById('shop-grid');
    if (!grid) return;
    try {
        const products = await Shop.listProducts();
        if (!products.length) { grid.innerHTML = '<p class="empty">No products yet.</p>'; return; }
        grid.innerHTML = products.map(p => `
            <a class="product-card" href="/product/${p.id}">
                <div class="product-name">${p.name}</div>
                <div class="product-price">${Shop.money(p.price)}</div>
                <div class="product-stock">${p.stock > 0 ? p.stock + ' in stock' : 'Sold out'}</div>
            </a>
        `).join('');
    } catch (e) {
        grid.innerHTML = `<p class="empty">Failed to load products: ${e.message}</p>`;
    }
}

// ── product.html: single product + add to cart ──────────────
async function renderProductPage() {
    const container = document.getElementById('product-detail');
    if (!container) return;
    const id = Shop.idFromPath();
    try {
        const p = await Shop.getProduct(id);
        if (!p) { container.innerHTML = '<p class="empty">Product not found.</p>'; return; }
        const sizeOptions = Array.isArray(p.sizes) && p.sizes.length
            ? `<select id="size-select">${p.sizes.map(s => `<option value="${s}">${s}</option>`).join('')}</select>`
            : '';
        container.innerHTML = `
            <h1>${p.name}</h1>
            <div class="product-price">${Shop.money(p.price)}</div>
            <p>${p.description || ''}</p>
            <div class="product-stock">${p.stock > 0 ? p.stock + ' in stock' : 'Sold out'}</div>
            ${sizeOptions}
            <input id="qty-input" type="number" value="1" min="1" max="${p.stock || 1}">
            <button id="add-to-cart-btn" ${p.stock > 0 ? '' : 'disabled'}>Add to cart</button>
            <div id="add-status"></div>
        `;
        document.getElementById('add-to-cart-btn')?.addEventListener('click', async () => {
            const status = document.getElementById('add-status');
            const size = document.getElementById('size-select')?.value;
            const qty = parseInt(document.getElementById('qty-input').value, 10) || 1;
            try {
                await Shop.addToCart(p.id, { size, qty });
                status.textContent = 'Added to cart.';
            } catch (e) {
                status.textContent = `Error: ${e.message}`;
            }
        });
    } catch (e) {
        container.innerHTML = `<p class="empty">Failed to load product: ${e.message}</p>`;
    }
}

// ── order.html: single order status ─────────────────────────
async function renderOrderPage() {
    const container = document.getElementById('order-detail');
    if (!container) return;
    const id = Shop.idFromPath();
    try {
        const order = await Shop.getOrder(id);
        container.innerHTML = `
            <h1>Order ${order.invoiceNumber || order.id}</h1>
            <div class="order-status">${order.status}</div>
            <ul class="order-items">
                ${order.items.map(i => `<li>${i.qty} × ${i.name}${i.size ? ' (' + i.size + ')' : ''} — ${Shop.money(i.price * i.qty)}</li>`).join('')}
            </ul>
            <div class="order-total">Total: ${Shop.money(order.total)}</div>
            <button id="download-pdf-btn">${order.status === 'paid' ? 'Download Receipt' : 'Download Invoice'} (PDF)</button>
            <div id="pdf-status"></div>
        `;
        document.getElementById('download-pdf-btn')?.addEventListener('click', async () => {
            const status = document.getElementById('pdf-status');
            try {
                await Shop.downloadOrderPdf(id, `${order.invoiceNumber || order.id}.pdf`);
            } catch (e) {
                status.textContent = `Error: ${e.message}`;
            }
        });
    } catch (e) {
        container.innerHTML = `<p class="empty">${e.message}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderShopPage();
    renderProductPage();
    renderOrderPage();
});
