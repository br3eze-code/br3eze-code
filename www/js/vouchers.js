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

  const _text = (value) => String(value ?? '');

  function _setMessage(el, className, message) {
    el.replaceChildren();
    const node = document.createElement('div');
    node.className = className;
    node.textContent = message;
    el.appendChild(node);
  }

  async function load() {
    const list = document.getElementById('voucher-list');
    _setMessage(list, 'list-loading', 'Loading vouchers…');
    try {
      const res = await Client.v1.vouchers({ limit: 100 });
      _all = res.data || [];
      render();
    } catch (e) {
      _setMessage(list, 'list-empty', `Failed to load: ${e.message || 'Unknown error'}`);
    }
  }

  function render() {
    const list = document.getElementById('voucher-list');
    let items = _all;
    if (_filter !== 'all') items = items.filter(v => (v.status || 'active') === _filter);
    if (_query) {
      const q = _query.toLowerCase();
      items = items.filter(v => _text(v.code).toLowerCase().includes(q));
    }
    list.replaceChildren();
    if (!items.length) {
      _setMessage(list, 'list-empty', 'No vouchers found.');
      return;
    }
    items.forEach(v => {
      const status = v.status || (v.used ? 'used' : 'active');
      const badgeClass = status === 'used' ? 'badge-used' : status === 'expired' ? 'badge-expired' : 'badge-active';
      const card = document.createElement('div');
      card.className = 'voucher-card'; card.tabIndex = 0; card.setAttribute('role', 'button');
      const code = document.createElement('div'); code.className = 'voucher-code'; code.textContent = _text(v.code);
      const meta = document.createElement('div'); meta.className = 'voucher-meta'; meta.textContent = v.createdAt ? new Date(v.createdAt).toLocaleDateString() : '—';
      const left = document.createElement('div'); left.append(code, meta);
      const badge = document.createElement('div'); badge.className = `voucher-badge ${badgeClass}`; badge.textContent = _text(status).toUpperCase();
      const plan = document.createElement('div'); plan.className = 'voucher-plan'; plan.textContent = _text(v.planName || v.plan || '—');
      card.append(left, badge, plan, document.createElement('div'));
      const open = () => showDetail(v.code);
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      list.appendChild(card);
    });
  }

  function filter(f, btn) {
    _filter = f;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    render();
  }

  function search(q) { _query = q; render(); }

  async function showDetail(code) {
    let v = _all.find(x => x.code === code);
    try { const res = await Client.v1.getVoucher(code); v = res.data || v; } catch (_) {}
    if (!v) return UI.toast('Voucher not found', 'err');
    const status = v.status || (v.used ? 'used' : 'active');
    UI.openModal('Voucher Detail', `
      <div class="vchr-detail-code">${_esc(v.code)}</div>
      <div class="vchr-detail-rows">
        <div class="vchr-row"><span class="lbl">PLAN</span><span class="val">${_esc(v.planName || v.plan || '—')}</span></div>
        <div class="vchr-row"><span class="lbl">STATUS</span><span class="val">${_esc(status.toUpperCase())}</span></div>
        <div class="vchr-row"><span class="lbl">DEVICE LIMIT</span><span class="val">${_esc(v.deviceLimit ?? 1)}</span></div>
        <div class="vchr-row"><span class="lbl">CREATED</span><span class="val">${_esc(v.createdAt ? new Date(v.createdAt).toLocaleString() : '—')}</span></div>
        <div class="vchr-row"><span class="lbl">EXPIRES</span><span class="val">${_esc(v.expiresAt ? new Date(v.expiresAt).toLocaleString() : 'No expiry')}</span></div>
        ${v.usedBy ? `<div class="vchr-row"><span class="lbl">USED BY</span><span class="val">${_esc(v.usedBy)}</span></div>` : ''}
      </div>
      <div class="vchr-actions">
        <button type="button" class="share-btn" data-voucher-action="share">↗ SHARE LOGIN LINK</button>
        <button type="button" class="share-btn" data-voucher-action="copy">⧉ COPY CODE</button>
      </div>`);
    const modal = document.querySelector('.modal-content, .modal, [role="dialog"]');
    if (!modal) return;
    const shareBtn = modal.querySelector('[data-voucher-action="share"]');
    const copyBtn = modal.querySelector('[data-voucher-action="copy"]');
    if (shareBtn) shareBtn.addEventListener('click', () => share(v.code));
    if (copyBtn) copyBtn.addEventListener('click', () => copyCode(v.code));
  }

  async function share(code) {
    const v = _all.find(x => x.code === code);
    const url = v?.loginUrl || `${Client.getBase()}/login.html?code=${encodeURIComponent(code)}`;
    if (navigator.share) { try { await navigator.share({ title: 'AgentOS Voucher', text: `Your WiFi voucher: ${code}`, url }); } catch (_) {} }
    else copyCode(code);
  }

  function copyCode(code) {
    navigator.clipboard?.writeText(code).then(() => UI.toast('Code copied', 'ok'), () => UI.toast('Copy failed', 'err'));
  }

  function openCreate() {
    const plans = Object.entries(CFG.PLANS);
    UI.openModal('New Voucher', `
      <div class="plan-grid" id="plan-grid">
        ${plans.map(([id, p]) => `<button type="button" class="plan-card ${id === _selectedPlan ? 'selected' : ''}" data-plan="${_esc(id)}"><span class="plan-name">${_esc(p.name)}</span><span class="plan-price">$${Number(p.price).toFixed(2)}</span><span class="plan-dur">${_esc(p.dur)}</span></button>`).join('')}
      </div>
      <div class="qty-row"><label>QUANTITY</label><input type="number" id="vchr-qty" class="qty-input" value="1" min="1" max="100"></div>
      <div class="modal-actions"><button type="button" class="modal-btn-cancel" data-voucher-action="cancel">CANCEL</button><button type="button" class="modal-btn-ok" data-voucher-action="generate">GENERATE</button></div>`);
    const modal = document.querySelector('.modal-content, .modal, [role="dialog"]');
    if (!modal) return;
    modal.querySelectorAll('.plan-card[data-plan]').forEach(card => card.addEventListener('click', () => selectPlan(card.dataset.plan)));
    const cancel = modal.querySelector('[data-voucher-action="cancel"]');
    const generate = modal.querySelector('[data-voucher-action="generate"]');
    if (cancel) cancel.addEventListener('click', () => UI.closeModal());
    if (generate) generate.addEventListener('click', submitCreate);
  }

  function selectPlan(id) {
    _selectedPlan = id;
    document.querySelectorAll('.plan-card').forEach(c => c.classList.toggle('selected', c.dataset.plan === id));
  }

  async function submitCreate() {
    const input = document.getElementById('vchr-qty');
    const qty = Math.max(1, Math.min(100, parseInt(input?.value, 10) || 1));
    UI.closeModal(); UI.toast(`Generating ${qty} voucher(s)…`, 'inf');
    try {
      if (qty > 1) await Client.v1.bulkVouchers(qty, _selectedPlan);
      else await Client.v1.createVoucher({ plan: _selectedPlan });
      UI.toast(`${qty} voucher(s) created`, 'ok');
      App.addActivity(`Generated ${qty}× ${_selectedPlan} voucher(s)`, 'ok');
      load(); App.refreshKpis();
    } catch (e) {
      const message = e.message || 'Unknown error';
      UI.toast(`Failed: ${message}`, 'err'); App.addActivity(`Voucher creation failed: ${message}`, 'err');
    }
  }

  function _esc(s) { return _text(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  return { load, render, filter, search, showDetail, share, copyCode, openCreate, selectPlan, submitCreate };
})();
