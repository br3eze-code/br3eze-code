/* ==========================================================
   FILE: payments.js
   DESCRIPTION: Stripe Elements — save/manage the card on file,
   and pay-with-saved-card top-ups. Replaces the old prompt()
   amount entry + hosted-Checkout-only flow with an in-app
   payment sheet; falls back to the Checkout redirect
   (window.topUpWithCard, defined in app.js) when no card is
   saved yet.
   ========================================================== */

async function agentOSPaymentRequest(url, options) {
    if (window.AgentOSOffline) {
        const result = await window.AgentOSOffline.request(url, options);
        if (result && result.queued) {
            return new Response(JSON.stringify({ offline: true, queued: true, paid: false, status: 'pending', idempotencyKey: result.idempotencyKey }), { status: 202, headers: { 'Content-Type': 'application/json', 'X-AgentOS-Offline': 'queued' } });
        }
        return result;
    }
    return fetch(url, options);
}

const Payments = {
    stripe: null,
    elements: null,
    els: { number: null, expiry: null, cvc: null },
    mounted: false,

    async ensureStripe() {
        if (this.stripe) return this.stripe;
        if (typeof Stripe === 'undefined' || !window.ENV || !window.ENV.STRIPE_PUBLISHABLE_KEY) return null;
        this.stripe = Stripe(window.ENV.STRIPE_PUBLISHABLE_KEY);
        return this.stripe;
    },

    mountElements() {
        if (this.mounted || !this.stripe) return;
        this.elements = this.stripe.elements();
        const style = {
            base: {
                color: '#ffffff',
                fontSize: '16px',
                fontFamily: 'Inter, sans-serif',
                '::placeholder': { color: '#6b6b6b' },
            },
            invalid: { color: '#ff8888' },
        };
        this.els.number = this.elements.create('cardNumber', { style, placeholder: 'Card Number' });
        this.els.expiry = this.elements.create('cardExpiry', { style });
        this.els.cvc = this.elements.create('cardCvc', { style });
        this.els.number.mount('#payCardNumber');
        this.els.expiry.mount('#payCardExpiry');
        this.els.cvc.mount('#payCardCvc');
        this.mounted = true;
    },

    async open() {
        const stripe = await this.ensureStripe();
        if (!stripe) return showToast('Card payments are not configured yet.', 'warning');
        this.mountElements();
        this.prefill();
        openModal('paymentMethodModal');
    },

    prefill() {
        const b = (window.currentUser && window.currentUser.billing) || {};
        const addr = b.address || {};
        const nameEl = document.getElementById('payCardName');
        if (nameEl && !nameEl.value) nameEl.value = (window.currentUser && window.currentUser.fullname) || '';
        document.getElementById('payAddrLine').value = addr.line1 || '';
        document.getElementById('payAddrCity').value = addr.city || '';
        document.getElementById('payAddrState').value = addr.state || '';
        if (addr.country) document.getElementById('payAddrCountry').value = addr.country;
        this.renderSavedCardSummary();
    },

    renderSavedCardSummary() {
        const el = document.getElementById('savedCardSummary');
        if (!el) return;
        const card = window.currentUser && window.currentUser.billing && window.currentUser.billing.card;
        if (!card) {
            el.innerHTML = `<p class="text-medium">No card on file yet.</p>`;
            return;
        }
        const brand = (card.brand || 'stripe').toLowerCase();
        const exp = `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`;
        el.innerHTML = `
            <div class="card-on-file">
                <i class="fab fa-cc-${brand === 'visa' || brand === 'mastercard' || brand === 'amex' || brand === 'discover' ? brand : 'stripe'}"></i>
                <span>•••• ${card.last4}</span>
                <span class="text-medium">Exp ${exp}</span>
                <button type="button" class="btn btn-sm" onclick="Payments.open()">Change</button>
            </div>`;
    },

    billingAddressFromForm() {
        return {
            line1: document.getElementById('payAddrLine').value.trim(),
            city: document.getElementById('payAddrCity').value.trim(),
            state: document.getElementById('payAddrState').value.trim(),
            country: document.getElementById('payAddrCountry').value.trim(),
        };
    },

    async _idToken() {
        // `auth` is a top-level `const` in app.js (classic script), not a
        // window property — reference it as a bare global, same as app.js.
        if (typeof auth === 'undefined' || !auth || !auth.currentUser) return null;
        return auth.currentUser.getIdToken();
    },

    _countryCode(name) {
        const map = {
            'South Africa': 'ZA', Zimbabwe: 'ZW', Botswana: 'BW',
            Namibia: 'NA', Mozambique: 'MZ', Zambia: 'ZM',
        };
        return map[name] || (name && name.length === 2 ? name.toUpperCase() : 'ZA');
    },

    async save(event) {
        event.preventDefault();
        if (!window.currentUser) return showToast('Please log in first.', 'error');
        const stripe = await this.ensureStripe();
        if (!stripe || !this.mounted) return;
        const name = document.getElementById('payCardName').value.trim();
        if (!name) return showToast('Enter the name on the card.', 'warning');
        const address = this.billingAddressFromForm();
        if (!address.line1 || !address.city) return showToast('Billing address is required.', 'warning');

        const saveBtn = document.getElementById('paySaveBtn');
        saveBtn.classList.add('is-loading');
        saveBtn.disabled = true;
        try {
            const idToken = await this._idToken();
            if (!idToken) throw new Error('Your session expired — please log in again.');

            const siRes = await agentOSPaymentRequest('/api/setup-intent/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: window.currentUser.id, idToken }),
            });
            const si = await siRes.json();
            if (!si.clientSecret) throw new Error(si.error || 'Could not start card setup.');

            const result = await stripe.confirmCardSetup(si.clientSecret, {
                payment_method: {
                    card: this.els.number,
                    billing_details: {
                        name,
                        address: {
                            line1: address.line1,
                            city: address.city,
                            state: address.state,
                            country: this._countryCode(address.country),
                        },
                    },
                },
            });
            if (result.error) throw new Error(result.error.message);

            const pmId = result.setupIntent.payment_method;
            const saveRes = await agentOSPaymentRequest('/api/payment-method/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: window.currentUser.id, idToken, paymentMethodId: pmId, billingAddress: address }),
            });
            const saved = await saveRes.json();
            if (!saveRes.ok) throw new Error(saved.error || 'Could not save card.');

            window.currentUser.billing = Object.assign({}, window.currentUser.billing, { card: saved.card, address: saved.address });
            this.renderSavedCardSummary();
            closeModal('paymentMethodModal');
            showToast('Card saved. 💳', 'success');
        } catch (e) {
            showToast(e.message || 'Could not save card.', 'error');
        } finally {
            saveBtn.classList.remove('is-loading');
            saveBtn.disabled = false;
        }
    },

    /* ── Top-up: pay with the saved card in-app, no redirect ── */
    openTopUp() {
        if (!window.currentUser || typeof auth === 'undefined' || !auth || !auth.currentUser) return showToast('Please log in first.', 'error');
        document.querySelectorAll('#topUpModal .amount-chip').forEach((c) => c.classList.remove('active'));
        const tenChip = Array.from(document.querySelectorAll('#topUpModal .amount-chip')).find((c) => c.textContent.trim() === '$10');
        if (tenChip) tenChip.classList.add('active');
        document.getElementById('topUpCustomAmount').value = 10;
        this._renderTopUpCardHint();
        openModal('topUpModal');
    },

    _renderTopUpCardHint() {
        const el = document.getElementById('topUpCardHint');
        if (!el) return;
        const card = window.currentUser && window.currentUser.billing && window.currentUser.billing.card;
        el.innerHTML = card
            ? `<i class="fab fa-cc-stripe"></i>Charging •••• ${card.last4} — <a onclick="closeModal('topUpModal'); Payments.open();">change card</a>`
            : `No saved card yet — <a onclick="closeModal('topUpModal'); Payments.open();">add a card</a> for one-tap top-ups, or continue below to pay via secure checkout.`;
    },

    pickAmount(val, btn) {
        document.querySelectorAll('#topUpModal .amount-chip').forEach((c) => c.classList.remove('active'));
        if (btn) btn.classList.add('active');
        document.getElementById('topUpCustomAmount').value = val;
    },

    async confirmTopUp() {
        const amount = parseFloat(document.getElementById('topUpCustomAmount').value);
        if (!(amount > 0)) return showToast('Enter a valid amount.', 'warning');
        const card = window.currentUser && window.currentUser.billing && window.currentUser.billing.card;
        if (!card) {
            // No saved card yet — fall back to the hosted Checkout redirect flow.
            closeModal('topUpModal');
            return window.topUpWithCard(amount);
        }
        const btn = document.getElementById('topUpConfirmBtn');
        btn.classList.add('is-loading');
        btn.disabled = true;
        try {
            const idToken = await this._idToken();
            if (!idToken) throw new Error('Your session expired — please log in again.');

            const res = await agentOSPaymentRequest('/api/charge-card', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: window.currentUser.id, idToken, amount, label: `Power Connect top-up ($${amount.toFixed(2)})` }),
            });
            const data = await res.json();
            if (data.offline && data.queued) {
                showToast('Payment request queued. It will not be charged until the server confirms it.', 'warning');
                return;
            }
            if (data.requiresAction) {
                const stripe = await this.ensureStripe();
                const result = await stripe.handleCardAction(data.clientSecret);
                if (result.error) throw new Error(result.error.message);
                const confirmRes = await agentOSPaymentRequest('/api/charge-card/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: window.currentUser.id, idToken, paymentIntentId: data.paymentIntentId }),
                });
                const confirmed = await confirmRes.json();
                if (!confirmed.paid) throw new Error('Payment was not completed.');
                await this._onTopUpSuccess(amount);
            } else if (data.paid) {
                await this._onTopUpSuccess(amount);
            } else {
                throw new Error(data.error || 'Payment failed.');
            }
        } catch (e) {
            showToast(e.message || 'Payment failed.', 'error');
        } finally {
            btn.classList.remove('is-loading');
            btn.disabled = false;
        }
    },

    async _onTopUpSuccess(amount) {
        closeModal('topUpModal');
        if (typeof refreshCurrentUser === 'function') await refreshCurrentUser();
        if (typeof updateUI === 'function') updateUI();
        if (typeof showSuccessCelebration === 'function') {
            showSuccessCelebration({ title: 'Top-Up Successful!', amount, subtitle: 'Your balance is loaded — buy plans or merch with it! 💳' });
        } else {
            showToast('Payment received — balance updated.', 'success');
        }
    },
};

window.Payments = Payments;

document.addEventListener('DOMContentLoaded', () => {
    Payments.ensureStripe().then((stripe) => {
        if (stripe) Payments.renderSavedCardSummary();
    });
});
