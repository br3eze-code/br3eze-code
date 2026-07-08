/* ==========================================================
   FILE: shop.js
   Branded merch shop — products, cart, search/filter, checkout
   with billing/shipping address, payment, and real invoices.
   Design language: Starlink-inspired (dark, bold, image-forward).
   Depends on: firebase (db), currentUser, showToast,
   showSuccessCelebration, openModal/closeModal, escapeHtml.
   ========================================================== */

const Shop = {
    products: [],
    cart: [],
    filter: 'all',
    search: '',
    _loaded: false,

    // Fallback emoji per category when a product has no image.
    _emoji: { tshirt: '👕', cap: '🧢', shoes: '👟', default: '🛍️' },
    SHIPPING_FLAT: 5,

    // ── Cart persistence ──────────────────────────────────────────────────
    _loadCart() {
        try { this.cart = JSON.parse(localStorage.getItem('shop_cart') || '[]'); }
        catch { this.cart = []; }
    },
    _saveCart() {
        localStorage.setItem('shop_cart', JSON.stringify(this.cart));
        this._updateFab();
    },
    count() { return this.cart.reduce((n, i) => n + i.qty, 0); },
    subtotal() { return this.cart.reduce((s, i) => s + i.price * i.qty, 0); },

    // ── Boot ──────────────────────────────────────────────────────────────
    async render() {
        this._loadCart();
        this._updateFab();
        document.getElementById('shopOrders')?.classList.add('hidden');
        document.getElementById('shopInventory')?.classList.add('hidden');
        document.getElementById('shopGrid')?.classList.remove('hidden');
        // Admins get the inventory toolbar.
        const isAdmin = currentUser && currentUser.role === 'admin';
        document.getElementById('shopAdminBar')?.classList.toggle('hidden', !isAdmin);
        if (!this._loaded) { this._skeleton(); await this.loadProducts(); }
        this.renderGrid();
    },

    // Animated placeholder cards so the first (~1-2s cold Firestore) load reads
    // as loading, not broken.
    _skeleton() {
        const grid = document.getElementById('shopGrid');
        if (!grid) return;
        grid.innerHTML = Array.from({ length: 4 }).map(() => `
            <div class="shop-card shop-skel">
                <div class="shop-card-img skel-box"></div>
                <div class="shop-card-body">
                    <span class="skel-line" style="width:40%"></span>
                    <span class="skel-line" style="width:80%"></span>
                    <span class="skel-line" style="width:55%"></span>
                    <span class="skel-line skel-btn"></span>
                </div>
            </div>`).join('');
    },

    // ── Admin: inventory management ───────────────────────────────────────
    _isAdmin() { return currentUser && currentUser.role === 'admin'; },

    openProductEditor(id) {
        if (!this._isAdmin()) return;
        const p = id ? this.products.find(x => x.id === id) : null;
        document.getElementById('productEditorTitle').textContent = p ? 'Edit Product' : 'Add Product';
        document.getElementById('prodId').value = p ? p.id : '';
        document.getElementById('prodName').value = p ? p.name : '';
        document.getElementById('prodDesc').value = p ? (p.description || '') : '';
        document.getElementById('prodCategory').value = p ? p.category : 'tshirt';
        document.getElementById('prodPrice').value = p ? p.price : '';
        document.getElementById('prodStock').value = p ? (p.stock || 0) : '';
        document.getElementById('prodSizes').value = p && Array.isArray(p.sizes) ? p.sizes.join(',') : '';
        document.getElementById('prodImage').value = p ? (p.imageUrl || '') : '';
        document.getElementById('prodActive').checked = p ? p.active !== false : true;
        document.getElementById('prodDeleteBtn').classList.toggle('hidden', !p);
        openModal('productEditorModal');
    },

    async saveProduct() {
        if (!this._isAdmin()) return showToast('Admin only', 'error');
        const id = document.getElementById('prodId').value.trim();
        const data = {
            name: document.getElementById('prodName').value.trim(),
            description: document.getElementById('prodDesc').value.trim(),
            category: document.getElementById('prodCategory').value,
            price: parseFloat(document.getElementById('prodPrice').value) || 0,
            stock: parseInt(document.getElementById('prodStock').value, 10) || 0,
            sizes: document.getElementById('prodSizes').value.split(',').map(s => s.trim()).filter(Boolean),
            imageUrl: document.getElementById('prodImage').value.trim(),
            active: document.getElementById('prodActive').checked,
        };
        try {
            if (id) {
                await db.collection('products').doc(id).update(data);
            } else {
                data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'product';
                await db.collection('products').doc(`${slug}-${Date.now().toString(36).slice(-4)}`).set(data);
            }
            closeModal('productEditorModal');
            showToast('Product saved', 'success');
            this._loaded = false; await this.loadProducts();
            if (!document.getElementById('shopInventory').classList.contains('hidden')) this.renderInventory();
            else this.renderGrid();
        } catch (e) { showToast(e.message, 'error'); }
    },

    async deleteProduct() {
        const id = document.getElementById('prodId').value;
        if (!id || !this._isAdmin()) return;
        if (!confirm('Delete this product permanently?')) return;
        try {
            await db.collection('products').doc(id).delete();
            closeModal('productEditorModal');
            showToast('Product deleted', 'info');
            this._loaded = false; await this.loadProducts(); this.renderInventory();
        } catch (e) { showToast(e.message, 'error'); }
    },

    async renderInventory() {
        if (!this._isAdmin()) return;
        document.getElementById('shopGrid')?.classList.add('hidden');
        document.getElementById('shopOrders')?.classList.add('hidden');
        const box = document.getElementById('shopInventory');
        box.classList.remove('hidden');
        if (!this._loaded) await this.loadProducts();
        // Include inactive/out-of-stock too — admin sees everything.
        const all = (await db.collection('products').orderBy('category').get()).docs.map(d => ({ id: d.id, ...d.data() }));
        const low = all.filter(p => (p.stock || 0) <= 5).length;
        box.innerHTML = `
            <div class="card" style="padding:0;">
                <div class="modal-header" style="padding:15px 20px;border-bottom:1px solid var(--color-border);">
                    <h3 style="font-size:1.05rem;">Inventory — ${all.length} products${low ? ` · <span style="color:#ffcc66;">${low} low stock</span>` : ''}</h3>
                    <button class="btn btn-sm btn-primary" onclick="Shop.openProductEditor()">+ Add</button>
                </div>
                <div style="overflow-x:auto;"><table class="admin-table"><thead><tr><th>Name</th><th>Cat</th><th>Price</th><th>Stock</th><th></th><th></th></tr></thead><tbody>
                ${all.map(p => `<tr${p.active === false ? ' style="opacity:0.5;"' : ''}>
                    <td>${escapeHtml(p.name)}${p.active === false ? ' <span class="text-medium">(hidden)</span>' : ''}</td>
                    <td>${escapeHtml(p.category || '')}</td>
                    <td>$${Number(p.price).toFixed(2)}</td>
                    <td style="${(p.stock || 0) <= 5 ? 'color:#ffcc66;font-weight:700;' : ''}">${p.stock || 0}</td>
                    <td><button class="btn btn-sm" onclick="Shop.restock('${p.id}')" title="Restock">+ Stock</button></td>
                    <td style="text-align:right;"><button class="btn btn-sm" onclick="Shop.openProductEditor('${p.id}')">Edit</button></td>
                </tr>`).join('')}
                </tbody></table></div>
            </div>`;
    },

    async restock(id) {
        if (!this._isAdmin()) return;
        const p = this.products.find(x => x.id === id) || (await db.collection('products').doc(id).get()).data();
        const add = prompt(`Add how many units to "${p.name}"? (current: ${p.stock || 0})`, '10');
        if (add === null) return;
        const n = parseInt(add, 10);
        if (isNaN(n)) return showToast('Enter a number', 'warning');
        try {
            await db.collection('products').doc(id).update({ stock: firebase.firestore.FieldValue.increment(n) });
            showToast(`Stock updated (+${n})`, 'success');
            this._loaded = false; await this.loadProducts(); this.renderInventory();
        } catch (e) { showToast(e.message, 'error'); }
    },

    async showAllOrders() {
        if (!this._isAdmin()) return;
        document.getElementById('shopGrid')?.classList.add('hidden');
        document.getElementById('shopInventory')?.classList.add('hidden');
        const box = document.getElementById('shopOrders');
        box.classList.remove('hidden');
        box.innerHTML = `<p class="text-medium" style="padding:24px;">Loading all orders…</p>`;
        try {
            const snap = await db.collection('orders').orderBy('createdAt', 'desc').limit(100).get();
            const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (!orders.length) { box.innerHTML = `<div class="shop-empty"><i class="fas fa-receipt"></i><p>No orders yet.</p></div>`; return; }
            box.innerHTML = orders.map(o => `
                <div class="card order-card">
                    <div class="order-head"><strong>${escapeHtml(o.invoiceNumber || o.id.slice(0, 8))}</strong>
                        <span class="order-status status-${(o.status || '').replace('_', '-')}">${escapeHtml((o.status || '').replace('_', ' '))}</span></div>
                    <div class="text-medium" style="font-size:0.85rem;margin:6px 0;">${escapeHtml(o.shippingAddress?.name || '')} · ${o.items.map(i => `${escapeHtml(i.name)} ×${i.qty}`).join(', ')}</div>
                    <div class="order-foot"><span class="text-medium">${escapeHtml(o.shippingAddress?.city || '')}, ${escapeHtml(o.shippingAddress?.country || '')}</span><strong>$${Number(o.total).toFixed(2)}</strong></div>
                </div>`).join('');
        } catch (e) { box.innerHTML = `<p class="text-medium" style="padding:24px;">${escapeHtml(e.message)}</p>`; }
    },

    async loadProducts() {
        const grid = document.getElementById('shopGrid');
        try {
            const snap = await db.collection('products').where('active', '==', true).get();
            this.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            this._loaded = true;
        } catch (e) {
            console.warn('[Shop] load failed:', e);
            if (grid) grid.innerHTML = `<p class="text-medium" style="padding:24px;">Could not load products. ${escapeHtml(e.message)}</p>`;
        }
    },

    onSearch(v) { this.search = (v || '').toLowerCase().trim(); this.renderGrid(); },
    onFilter(cat) {
        this.filter = cat;
        document.querySelectorAll('#shopFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.cat === cat));
        document.getElementById('shopOrders')?.classList.add('hidden');
        document.getElementById('shopGrid')?.classList.remove('hidden');
        this.renderGrid();
    },

    _visible() {
        return this.products.filter(p => {
            if (this.filter !== 'all' && p.category !== this.filter) return false;
            if (this.search && !(`${p.name} ${p.description || ''} ${p.category}`.toLowerCase().includes(this.search))) return false;
            return true;
        });
    },

    renderGrid() {
        const grid = document.getElementById('shopGrid');
        if (!grid) return;
        const items = this._visible();
        if (!items.length) {
            grid.innerHTML = `<div class="shop-empty"><i class="fas fa-store-slash"></i><p>No products match your search.</p></div>`;
            return;
        }
        grid.innerHTML = items.map(p => {
            const out = (p.stock || 0) <= 0;
            const img = p.imageUrl
                ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" loading="lazy">`
                : `<span class="shop-card-emoji">${this._emoji[p.category] || this._emoji.default}</span>`;
            const sizes = Array.isArray(p.sizes) && p.sizes.length
                ? `<select class="shop-size" id="size_${p.id}">${p.sizes.map(s => `<option>${escapeHtml(String(s))}</option>`).join('')}</select>`
                : '';
            return `
            <div class="shop-card ${out ? 'out' : ''}">
                <div class="shop-card-img">${img}${out ? '<span class="shop-badge">Sold out</span>' : ''}</div>
                <div class="shop-card-body">
                    <span class="shop-card-cat">${escapeHtml((p.category || '').toUpperCase())}</span>
                    <h3 class="shop-card-name">${escapeHtml(p.name)}</h3>
                    <div class="shop-card-foot">
                        <span class="shop-card-price">$${Number(p.price).toFixed(2)}</span>
                        ${sizes}
                    </div>
                    <button class="btn btn-primary btn-block shop-add" ${out ? 'disabled' : ''}
                        onclick="Shop.addToCart('${p.id}')">${out ? 'Sold out' : 'Add to Cart'}</button>
                </div>
            </div>`;
        }).join('');
    },

    addToCart(productId) {
        const p = this.products.find(x => x.id === productId);
        if (!p) return;
        const size = document.getElementById(`size_${productId}`)?.value || null;
        const key = productId + (size ? '|' + size : '');
        const existing = this.cart.find(i => i.key === key);
        const inCart = existing ? existing.qty : 0;
        if (inCart + 1 > (p.stock || 0)) return showToast(`Only ${p.stock} in stock`, 'warning');
        if (existing) existing.qty += 1;
        else this.cart.push({ key, productId, name: p.name, price: Number(p.price), size, qty: 1, category: p.category, imageUrl: p.imageUrl || '' });
        this._saveCart();
        showToast(`Added ${p.name}${size ? ' (' + size + ')' : ''} to cart`, 'success');
    },

    _updateFab() {
        const n = this.count();
        const fab = document.getElementById('cartFab');
        const badge = document.getElementById('cartCount');
        if (badge) badge.textContent = n;
        if (fab) fab.classList.toggle('hidden', n === 0);
        // Navbar cart — shows count and only appears once something is in the cart.
        const navCart = document.getElementById('navCart');
        const navBadge = document.getElementById('navCartCount');
        if (navBadge) navBadge.textContent = n;
        if (navCart) navCart.classList.toggle('hidden', n === 0);
    },

    // ── Cart modal ────────────────────────────────────────────────────────
    openCart() {
        this.renderCart();
        openModal('cartModal');
    },
    renderCart() {
        const box = document.getElementById('cartItems');
        const sum = document.getElementById('cartSummary');
        const btn = document.getElementById('cartCheckoutBtn');
        if (!box) return;
        if (!this.cart.length) {
            box.innerHTML = `<div class="shop-empty" style="padding:24px 0;"><i class="fas fa-shopping-bag"></i><p>Your cart is empty.</p></div>`;
            if (sum) sum.innerHTML = '';
            if (btn) btn.disabled = true;
            return;
        }
        if (btn) btn.disabled = false;
        box.innerHTML = this.cart.map(i => `
            <div class="cart-row">
                <span class="cart-thumb">${i.imageUrl ? `<img src="${escapeHtml(i.imageUrl)}" alt="">` : (this._emoji[i.category] || this._emoji.default)}</span>
                <div class="cart-row-info">
                    <div class="cart-row-name">${escapeHtml(i.name)}${i.size ? ` · <span class="text-medium">${escapeHtml(i.size)}</span>` : ''}</div>
                    <div class="cart-row-price">$${(i.price * i.qty).toFixed(2)}</div>
                </div>
                <div class="cart-qty">
                    <button onclick="Shop.updateQty('${i.key}',-1)">−</button>
                    <span>${i.qty}</span>
                    <button onclick="Shop.updateQty('${i.key}',1)">+</button>
                </div>
                <button class="cart-remove" onclick="Shop.removeItem('${i.key}')" title="Remove">✕</button>
            </div>`).join('');
        const sub = this.subtotal();
        const ship = sub > 0 ? this.SHIPPING_FLAT : 0;
        if (sum) sum.innerHTML = `
            <div class="cart-line"><span>Subtotal</span><span>$${sub.toFixed(2)}</span></div>
            <div class="cart-line"><span>Shipping</span><span>$${ship.toFixed(2)}</span></div>
            <div class="cart-line cart-total"><span>Total</span><span>$${(sub + ship).toFixed(2)}</span></div>`;
    },
    updateQty(key, delta) {
        const it = this.cart.find(i => i.key === key);
        if (!it) return;
        const p = this.products.find(x => x.id === it.productId);
        if (delta > 0 && p && it.qty + 1 > (p.stock || 0)) return showToast(`Only ${p.stock} in stock`, 'warning');
        it.qty += delta;
        if (it.qty <= 0) this.cart = this.cart.filter(i => i.key !== key);
        this._saveCart();
        this.renderCart();
    },
    removeItem(key) {
        this.cart = this.cart.filter(i => i.key !== key);
        this._saveCart();
        this.renderCart();
    },
    clearCart() { this.cart = []; this._saveCart(); },

    // ── Checkout ──────────────────────────────────────────────────────────
    openCheckout() {
        if (!this.cart.length) return showToast('Your cart is empty', 'warning');
        if (!currentUser) return showToast('Please log in', 'error');
        const sub = this.subtotal(), ship = this.SHIPPING_FLAT, total = sub + ship;
        document.getElementById('checkoutSummary').innerHTML = `
            ${this.cart.map(i => `<div class="cart-line"><span>${escapeHtml(i.name)}${i.size ? ' · ' + escapeHtml(i.size) : ''} ×${i.qty}</span><span>$${(i.price * i.qty).toFixed(2)}</span></div>`).join('')}
            <div class="cart-line"><span>Shipping</span><span>$${ship.toFixed(2)}</span></div>
            <div class="cart-line cart-total"><span>Total</span><span>$${total.toFixed(2)}</span></div>`;
        // Prefill name/phone from profile
        document.getElementById('shipName').value = currentUser.fullname || '';
        document.getElementById('shipPhone').value = currentUser.phoneNumber || '';
        document.getElementById('shipStreet').value = currentUser.address || '';
        const bal = (currentUser.credits || 0);
        document.getElementById('payBalanceHint').textContent = `($${bal.toFixed(2)} available)`;
        const creditsRadio = document.querySelector('input[name=payMethod][value=credits]');
        if (creditsRadio) creditsRadio.disabled = bal < total; // can't pay with credits if short
        if (bal < total) document.querySelector('input[name=payMethod][value=cod]').checked = true;
        closeModal('cartModal');
        openModal('checkoutModal');
    },
    toggleBilling(same) { document.getElementById('billingFields').classList.toggle('hidden', same); },
    onPayMethod() { /* reserved for future provider redirect */ },

    _address(prefix) {
        return {
            street: document.getElementById(prefix + 'Street')?.value.trim() || '',
            city: document.getElementById(prefix + 'City')?.value.trim() || '',
            zip: document.getElementById(prefix + 'Zip')?.value.trim() || '',
        };
    },

    async placeOrder() {
        if (!this.cart.length) return;
        const btn = document.getElementById('placeOrderBtn');
        const items = this.cart.map(i => ({ productId: i.productId, name: i.name, size: i.size || null, qty: i.qty, price: i.price }));
        const sub = this.subtotal(), shipping = this.SHIPPING_FLAT, total = sub + shipping;
        const payMethod = document.querySelector('input[name=payMethod]:checked')?.value || 'cod';

        const shipping_addr = {
            name: document.getElementById('shipName').value.trim(),
            phone: document.getElementById('shipPhone').value.trim(),
            ...this._address('ship'),
            country: document.getElementById('shipCountry').value.trim(),
        };
        const billingSame = document.getElementById('billingSame').checked;
        const billing_addr = billingSame ? shipping_addr : { ...this._address('bill'), country: shipping_addr.country };

        if (payMethod === 'credits' && (currentUser.credits || 0) < total) {
            return showToast('Insufficient balance — redeem a voucher or choose Cash on Delivery.', 'error');
        }

        btn.disabled = true; btn.textContent = 'Placing order…';
        const orderRef = db.collection('orders').doc();
        const invoiceRef = db.collection('invoices').doc();
        const number = 'INV-' + Date.now().toString(36).toUpperCase();

        try {
            await db.runTransaction(async (tx) => {
                // READS first (Firestore requirement)
                const prod = {};
                for (const it of items) {
                    const ref = db.collection('products').doc(it.productId);
                    const s = await tx.get(ref);
                    if (!s.exists) throw new Error(`${it.name} is no longer available`);
                    prod[it.productId] = { ref, stock: s.data().stock || 0 };
                }
                let bal = 0;
                if (payMethod === 'credits') {
                    const us = await tx.get(db.collection('users').doc(currentUser.id));
                    bal = us.data().credits || 0;
                }
                // VALIDATE
                const need = {};
                for (const it of items) need[it.productId] = (need[it.productId] || 0) + it.qty;
                for (const pid in need) if (prod[pid].stock < need[pid]) throw new Error(`Not enough stock for one of your items`);
                if (payMethod === 'credits' && bal < total) throw new Error('Insufficient balance');
                // WRITES
                for (const pid in need) tx.update(prod[pid].ref, { stock: prod[pid].stock - need[pid] });
                if (payMethod === 'credits' && total > 0) {
                    tx.update(db.collection('users').doc(currentUser.id), { credits: bal - total });
                }
                const status = payMethod === 'cod' ? 'pending_payment' : 'paid';
                tx.set(orderRef, {
                    userId: currentUser.id, items, subtotal: sub, shipping, total,
                    currency: 'USD', status, payMethod,
                    shippingAddress: shipping_addr, billingAddress: billing_addr,
                    invoiceId: invoiceRef.id, invoiceNumber: number,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
                // Real line-item invoice (patches the stubbed generateInvoice).
                tx.set(invoiceRef, {
                    userId: currentUser.id, orderId: orderRef.id, number,
                    lineItems: items.map(i => ({ description: `${i.name}${i.size ? ' (' + i.size + ')' : ''}`, qty: i.qty, unitPrice: i.price, amount: +(i.price * i.qty).toFixed(2) })),
                    subtotal: sub, shipping, total, currency: 'USD',
                    billingAddress: billing_addr, status: payMethod === 'cod' ? 'unpaid' : 'paid',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                });
            });

            this.clearCart();
            this._loaded = false; // refresh stock next view
            closeModal('checkoutModal');
            if (payMethod === 'credits' && typeof refreshCurrentUser === 'function') {
                await refreshCurrentUser(); if (typeof updateUI === 'function') updateUI();
            }
            if (typeof showSuccessCelebration === 'function') {
                showSuccessCelebration({
                    title: 'Order Placed!', amount: total,
                    subtitle: payMethod === 'cod' ? `Order ${number} confirmed. Pay cash on delivery. 📦` : `Order ${number} paid from your balance. We'll ship it soon! 📦`
                });
            } else showToast('Order placed!', 'success');
        } catch (e) {
            showToast(e.message || 'Checkout failed', 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Place Order';
        }
    },

    // ── My Orders ─────────────────────────────────────────────────────────
    async showMyOrders() {
        document.querySelectorAll('#shopFilters .chip').forEach(c => c.classList.remove('active'));
        document.getElementById('shopGrid')?.classList.add('hidden');
        const box = document.getElementById('shopOrders');
        box.classList.remove('hidden');
        box.innerHTML = `<p class="text-medium" style="padding:24px;">Loading your orders…</p>`;
        try {
            const snap = await db.collection('orders').where('userId', '==', currentUser.id).get();
            const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            if (!orders.length) { box.innerHTML = `<div class="shop-empty"><i class="fas fa-box-open"></i><p>No orders yet.</p></div>`; return; }
            box.innerHTML = orders.map(o => `
                <div class="card order-card">
                    <div class="order-head">
                        <strong>${escapeHtml(o.invoiceNumber || o.id.slice(0, 8))}</strong>
                        <span class="order-status status-${(o.status || '').replace('_', '-')}">${escapeHtml((o.status || '').replace('_', ' '))}</span>
                    </div>
                    <div class="text-medium" style="font-size:0.85rem;margin:6px 0;">${o.items.map(i => `${escapeHtml(i.name)}${i.size ? ' (' + escapeHtml(i.size) + ')' : ''} ×${i.qty}`).join(', ')}</div>
                    <div class="order-foot"><span class="text-medium">${o.shippingAddress?.city ? escapeHtml(o.shippingAddress.city) : ''}</span><strong>$${Number(o.total).toFixed(2)}</strong></div>
                </div>`).join('');
        } catch (e) {
            box.innerHTML = `<p class="text-medium" style="padding:24px;">Could not load orders. ${escapeHtml(e.message)}</p>`;
        }
    },
};
window.Shop = Shop;

// Reflect a persisted cart in the navbar as soon as the app loads.
document.addEventListener('DOMContentLoaded', () => {
    try { Shop._loadCart(); Shop._updateFab(); } catch (e) { /* deps not ready */ }
});
