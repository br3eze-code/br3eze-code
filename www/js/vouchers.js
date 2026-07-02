/**
 * AgentOS Hermes — vouchers.js
 * Voucher list, filter, search, create/detail modals
 */
'use strict';

const Vouchers = (() => {
  let _all = [];
  let _filter = 'all';
  let _query = '';
  let _selectedPlan = '1Day';

  async function load() {
    const list = document.getElementById('voucher-list');
    list.innerHTML = '<div class="list-loading">Loading vouchers…</div>';
    try {
      const res = await Client.v1.vouchers({ limit: 100 });
      _all = res.data || [];
      render();
    } catch (e) {
      list.innerHTML = `<div class="list-empty">Failed to load: ${e.message}</div>`;
    }
  }

  function render() {
    const list = document.getElementById('voucher-list');
    let items = _all;

    if (_filter !== 'all') items = items.filter(v => (v.status || 'active') === _filter);
    if (_query) {
      const q = _query.toLowerCase();
      items = items.filter(v => (v.code || '').toLowerCase().includes(q));
    }

    if (!items.length) {
      list.innerHTML = '<div class="list-empty">No vouchers found.</div>';
      return;
    }

    list.innerHTML = items
      .map(v => {
        const status = v.status || (v.used ? 'used' : 'active');
        const badgeClass =
          status === 'used'
            ? 'badge-used'
            : status === 'expired'
              ? 'badge-expired'
              : 'badge-active';
        return `
        <div class="voucher-card" onclick="Vouchers.showDetail('${_esc(v.code)}')">
          <div>
            <div class="voucher-code">${_esc(v.code)}</div>
            <div class="voucher-meta">${v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—'}</div>
          </div>
          <div class="voucher-badge ${badgeClass}">${status.toUpperCase()}</div>
          <div class="voucher-plan">${_esc(v.planName || v.plan || '—')}</div>
          <div></div>
        </div>`;
      })
      .join('');
  }

  function filter(f, btn) {
    _filter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    render();
  }

  function search(q) {
    _query = q;
    render();
  }

  async function showDetail(code) {
    let v = _all.find(x => x.code === code);
    try {
      const res = await Client.v1.getVoucher(code);
      v = res.data || v;
    } catch (_) {}
    if (!v) return UI.toast('Voucher not found', 'err');

    const status = v.status || (v.used ? 'used' : 'active');
    UI.openModal(
      'Voucher Detail',
      `
      <div class="vchr-detail-code">${_esc(v.code)}</div>
      <div class="vchr-detail-rows">
        <div class="vchr-row"><span class="lbl">PLAN</span><span class="val">${_esc(v.planName || v.plan || '—')}</span></div>
        <div class="vchr-row"><span class="lbl">STATUS</span><span class="val">${status.toUpperCase()}</span></div>
        <div class="vchr-row"><span class="lbl">DEVICE LIMIT</span><span class="val">${v.deviceLimit ?? 1}</span></div>
        <div class="vchr-row"><span class="lbl">CREATED</span><span class="val">${v.createdAt ? new Date(v.createdAt).toLocaleString() : '—'}</span></div>
        <div class="vchr-row"><span class="lbl">EXPIRES</span><span class="val">${v.expiresAt ? new Date(v.expiresAt).toLocaleString() : 'No expiry'}</span></div>
        ${v.usedBy ? `<div class="vchr-row"><span class="lbl">USED BY</span><span class="val">${_esc(v.usedBy)}</span></div>` : ''}
      </div>
      <button class="share-btn" onclick="Vouchers.share('${_esc(v.code)}')">↗ SHARE LOGIN LINK</button>
      <button class="share-btn" onclick="Vouchers.copyCode('${_esc(v.code)}')">⧉ COPY CODE</button>
    `
    );
  }

  async function share(code) {
    const v = _all.find(x => x.code === code);
    const url = v?.loginUrl || `${Client.getBase()}/login.html?code=${code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'AgentOS Voucher',
          text: `Your WiFi voucher: ${code}`,
          url,
        });
      } catch (_) {}
    } else {
      copyCode(code);
    }
  }

  function copyCode(code) {
    navigator.clipboard?.writeText(code).then(
      () => UI.toast('Code copied', 'ok'),
      () => UI.toast('Copy failed', 'err')
    );
  }

  // ── Create flow ────────────────────────────────────────────────
  function openCreate() {
    const plans = Object.entries(CFG.PLANS);
    UI.openModal(
      'New Voucher',
      `
      <div class="plan-grid" id="plan-grid">
        ${plans
          .map(
            ([id, p]) => `
          <div class="plan-card ${id === _selectedPlan ? 'selected' : ''}" data-plan="${id}" onclick="Vouchers.selectPlan('${id}')">
            <div class="plan-name">${_esc(p.name)}</div>
            <div class="plan-price">$${p.price.toFixed(2)}</div>
            <div class="plan-dur">${_esc(p.dur)}</div>
          </div>`
          )
          .join('')}
      </div>
      <div class="qty-row">
        <label>QUANTITY</label>
        <input type="number" id="vchr-qty" class="qty-input" value="1" min="1" max="100">
      </div>
      <div class="modal-actions">
        <button class="modal-btn-cancel" onclick="UI.closeModal()">CANCEL</button>
        <button class="modal-btn-ok" onclick="Vouchers.submitCreate()">GENERATE</button>
      </div>
    `
    );
  }

  function selectPlan(id) {
    _selectedPlan = id;
    document
      .querySelectorAll('.plan-card')
      .forEach(c => c.classList.toggle('selected', c.dataset.plan === id));
  }

  async function submitCreate() {
    const qty = Math.max(
      1,
      Math.min(100, parseInt(document.getElementById('vchr-qty').value) || 1)
    );
    UI.closeModal();
    UI.toast(`Generating ${qty} voucher(s)…`, 'inf');
    try {
      let result;
      if (qty > 1) {
        result = await Client.v1.bulkVouchers(qty, _selectedPlan);
      } else {
        result = await Client.v1.createVoucher({ plan: _selectedPlan });
      }
      UI.toast(`${qty} voucher(s) created`, 'ok');
      App.addActivity(`Generated ${qty}× ${_selectedPlan} voucher(s)`, 'ok');
      load();
      App.refreshKpis();
    } catch (e) {
      UI.toast(`Failed: ${e.message}`, 'err');
      App.addActivity(`Voucher creation failed: ${e.message}`, 'err');
    }
  }

  function _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    load,
    render,
    filter,
    search,
    showDetail,
    share,
    copyCode,
    openCreate,
    selectPlan,
    submitCreate,
  };
})();
