/**
 * AgentOS Hermes — app.js
 * Bootstrap · tab routing · KPI polling · settings · activity log
 */
'use strict';

const App = (() => {
  let _kpiTid = null;

  // ── Boot ───────────────────────────────────────────────────────
  function init() {
    document.getElementById('hdr-ver').textContent = 'v' + CFG.VER.replace(/\..+$/, '');
    document.getElementById('abt-ver').textContent  = CFG.APP + ' v' + CFG.VER;

    _loadSettingsIntoForm();
    _restoreActivity();

    const url   = Store.get(KEYS.URL, '');
    const token = Store.get(KEYS.TOKEN, '');
    if (url) {
      Client.configure(url, token);
      _connect(url, token);
    }

    WS.on('open',  () => _setConnStatus(true));
    WS.on('close', () => _setConnStatus(false));
    WS.on('retry', () => _setConnStatus(false));
    WS.on('voucher.created', (m) => { addActivity(`Voucher ${m.code || ''} created`, 'ok'); refreshKpis(); });
    WS.on('user.connected',  (m) => { addActivity(`${m.user || 'User'} connected`, 'ok'); refreshKpis(); });
    WS.on('user.disconnected',(m) => { addActivity(`${m.user || 'User'} disconnected`, 'inf'); refreshKpis(); });
    WS.on('payment.received',(m) => { addActivity(`Payment received: $${m.amount || '?'}`, 'ok'); refreshKpis(); });

    Agent.init();
    refreshKpis();
    _kpiTid = setInterval(refreshKpis, 30000);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshKpis();
    });
  }

  function _connect(url, token) {
    WS.connect(url, token);
  }

  // ── Tabs ───────────────────────────────────────────────────────
  function switchTab(name, btn) {
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + name)?.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    (btn || document.querySelector(`.nav-btn[data-tab="${name}"]`))?.classList.add('active');

    if (name === 'vouchers') Vouchers.load();
    if (name === 'users')    Users.refresh();
    if (name === 'agent')    setTimeout(() => document.getElementById('agent-input')?.focus(), 100);
  }

  // ── KPIs ───────────────────────────────────────────────────────
  async function refreshKpis() {
    if (!Client.hasConfig()) return;
    try {
      const [active, vstats, fin] = await Promise.allSettled([
        Client.v1.activeUsers(),
        Client.v1.voucherStats(),
        Client.v2.financialSummary(),
      ]);

      if (active.status === 'fulfilled') {
        const n = (active.value.data || []).length;
        document.getElementById('kpi-active').textContent = n;
      }
      if (vstats.status === 'fulfilled') {
        const d = vstats.value.data || {};
        document.getElementById('kpi-vouchers').textContent = d.active ?? d.total ?? '—';
      }
      if (fin.status === 'fulfilled') {
        const d = fin.value.data || {};
        const today = d.today ?? d.todayRevenue ?? 0;
        document.getElementById('kpi-revenue').textContent = '$' + Number(today).toFixed(0);
      }

      try {
        const health = await Client.v1.health();
        const mt = health.data?.services?.mikrotik;
        document.getElementById('kpi-health').textContent = mt ? 'ONLINE' : 'OFFLINE';
      } catch(_) {
        document.getElementById('kpi-health').textContent = '—';
      }
    } catch(_) {}
  }

  // ── Quick actions ──────────────────────────────────────────────
  function createVoucher() {
    if (!Client.hasConfig()) { UI.toast('Configure gateway first', 'wrn'); switchTab('settings'); return; }
    Vouchers.openCreate();
  }

  async function executeTool(toolId) {
    const t = Tools.get(toolId);
    const out = document.getElementById('tool-out');

    if (t?.dangerous) {
      UI.confirm(`Run "${t.label}"? This action cannot be undone.`, () => _runTool(toolId));
      return;
    }
    _runTool(toolId);
  }

  async function _runTool(toolId) {
    const out = document.getElementById('tool-out');
    if (out) out.textContent = 'Running ' + toolId + '…';
    if (!Client.hasConfig()) {
      UI.toast('Configure gateway first', 'wrn');
      switchTab('settings');
      return;
    }
    try {
      const result = await Tools.run(toolId);
      if (out) out.textContent = result.text;
      addActivity(`${toolId} executed`, 'ok');
      if (toolId === 'router.reboot') refreshKpis();
    } catch (e) {
      if (out) out.textContent = `ERROR: ${e.message}`;
      addActivity(`${toolId} failed: ${e.message}`, 'err');
      UI.toast(e.message, 'err');
    }
  }

  function pingPrompt() {
    UI.openModal('Ping Host', `
      <div class="ping-form">
        <input type="text" id="ping-host" class="ping-input" placeholder="8.8.8.8 or domain.com" value="8.8.8.8">
        <div class="modal-actions">
          <button class="modal-btn-cancel" onclick="UI.closeModal()">CANCEL</button>
          <button class="modal-btn-ok" onclick="App.runPing()">PING</button>
        </div>
      </div>
    `);
  }

  async function runPing() {
    const host = document.getElementById('ping-host').value.trim();
    UI.closeModal();
    switchTab('tools');
    const out = document.getElementById('tool-out');
    out.textContent = `Pinging ${host}…`;
    try {
      const result = await Tools.run('network.ping', { host });
      out.textContent = result.text;
    } catch (e) {
      out.textContent = `ERROR: ${e.message}`;
    }
  }

  // ── Settings ───────────────────────────────────────────────────
  function _loadSettingsIntoForm() {
    document.getElementById('cfg-url').value   = Store.get(KEYS.URL, '');
    document.getElementById('cfg-token').value = Store.get(KEYS.TOKEN, '');
    document.getElementById('cfg-model').value = Store.get(KEYS.MODEL, 'gemini');
    document.getElementById('cfg-turns').value = Store.get(KEYS.TURNS, CFG.REACT_MAX_TURNS);
  }

  function saveSettings() {
    const url   = document.getElementById('cfg-url').value.trim().replace(/\/$/, '');
    const token = document.getElementById('cfg-token').value.trim();
    const model = document.getElementById('cfg-model').value;
    const turns = document.getElementById('cfg-turns').value;

    if (!url) { UI.toast('Gateway URL required', 'err'); return; }

    Store.set(KEYS.URL, url);
    Store.set(KEYS.TOKEN, token);
    Store.set(KEYS.MODEL, model);
    Store.set(KEYS.TURNS, turns);

    Client.configure(url, token);
    WS.disconnect();
    _connect(url, token);

    UI.toast('Settings saved', 'ok');
    refreshKpis();
  }

  async function testConnection() {
    const url   = document.getElementById('cfg-url').value.trim().replace(/\/$/, '');
    const token = document.getElementById('cfg-token').value.trim();
    if (!url) { UI.toast('Enter a URL first', 'err'); return; }

    UI.toast('Testing…', 'inf');
    const tmpBase = Client.getBase();
    Client.configure(url, token);
    try {
      const res = await Client.v1.health();
      UI.toast('Connected ✓ ' + (res.version || ''), 'ok');
    } catch (e) {
      UI.toast('Failed: ' + e.message, 'err');
      if (tmpBase) Client.configure(tmpBase, token);
    }
  }

  // ── Connection status pill ───────────────────────────────────
  function _setConnStatus(online) {
    const pill  = document.getElementById('conn-pill');
    const label = document.getElementById('conn-label');
    pill.classList.toggle('online', online);
    label.textContent = online ? 'ONLINE' : 'OFFLINE';
  }

  // ── Activity log ───────────────────────────────────────────────
  function addActivity(msg, kind = 'inf') {
    const list = document.getElementById('activity-list');
    const empty = list.querySelector('.activity-empty');
    if (empty) empty.remove();

    const li = document.createElement('li');
    li.className = `activity-item act-${kind}`;
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<span class="act-ts">${ts}</span><span class="act-msg">${_esc(msg)}</span>`;
    list.insertBefore(li, list.firstChild);

    while (list.children.length > 40) list.removeChild(list.lastChild);
    _saveActivity();
  }

  function clearActivity() {
    document.getElementById('activity-list').innerHTML = '<li class="activity-empty">Waiting for events…</li>';
    Store.del(KEYS.ACTIVITY);
  }

  function _saveActivity() {
    const items = Array.from(document.querySelectorAll('#activity-list .activity-item')).slice(0, 40).map(li => ({
      ts: li.querySelector('.act-ts').textContent,
      msg: li.querySelector('.act-msg').textContent,
      kind: li.className.includes('act-ok') ? 'ok' : li.className.includes('act-err') ? 'err' : 'inf',
    }));
    Store.set(KEYS.ACTIVITY, items);
  }

  function _restoreActivity() {
    const items = Store.get(KEYS.ACTIVITY, []);
    if (!items.length) return;
    const list = document.getElementById('activity-list');
    list.innerHTML = items.map(i =>
      `<li class="activity-item act-${i.kind}"><span class="act-ts">${i.ts}</span><span class="act-msg">${_esc(i.msg)}</span></li>`
    ).join('');
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return {
    init, switchTab, refreshKpis, createVoucher, executeTool, pingPrompt, runPing,
    saveSettings, testConnection, addActivity, clearActivity,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
document.addEventListener('deviceready', App.init); // Cordova
