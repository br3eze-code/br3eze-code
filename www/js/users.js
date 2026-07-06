/**
 * AgentOS Hermes — users.js
 * Hotspot user lists: active sessions + all configured users
 */
'use strict';

const Users = (() => {

  async function refresh() {
    await Promise.all([_loadActive(), _loadAll()]);
  }

  async function _loadActive() {
    const box = document.getElementById('active-users-list');
    box.innerHTML = '<div class="list-loading">Loading…</div>';
    try {
      const res = await Client.v1.activeUsers();
      const users = res.data || [];
      if (!users.length) { box.innerHTML = '<div class="list-empty">No active sessions.</div>'; return; }
      box.innerHTML = users.map(u => `
        <div class="user-card">
          <div>
            <div class="user-name">${_esc(u.user || u.username || u['.id'] || '?')}</div>
            <div class="user-ip">${_esc(u.address || '—')} · ${_esc(u.uptime || '—')}</div>
          </div>
          <div class="user-actions">
            <button class="kick-btn" onclick="Users.disconnect('${_esc(u['.id'] || u.id)}')">KICK</button>
          </div>
        </div>`).join('');
    } catch (e) {
      box.innerHTML = `<div class="list-empty">Failed: ${e.message}</div>`;
    }
  }

  async function _loadAll() {
    const box = document.getElementById('all-users-list');
    box.innerHTML = '<div class="list-loading">Loading…</div>';
    try {
      const res = await Client.v1.allUsers();
      const users = res.data || [];
      if (!users.length) { box.innerHTML = '<div class="list-empty">No users configured.</div>'; return; }
      box.innerHTML = users.map(u => `
        <div class="user-card">
          <div>
            <div class="user-name">${_esc(u.name || u.username || '?')}</div>
            <div class="user-mac">${_esc(u.profile || 'default')}</div>
          </div>
          <div class="user-actions">
            <button class="kick-btn" onclick="Users.remove('${_esc(u.name || u.username)}')">DEL</button>
          </div>
        </div>`).join('');
    } catch (e) {
      box.innerHTML = `<div class="list-empty">Failed: ${e.message}</div>`;
    }
  }

  async function disconnect(id) {
    if (!id) return;
    try {
      await Client.v1.disconnect(id);
      UI.toast('Disconnected', 'ok');
      _loadActive();
      App.refreshKpis();
    } catch (e) {
      UI.toast(`Failed: ${e.message}`, 'err');
    }
  }

  async function remove(username) {
    if (!username) return;
    UI.confirm(`Delete user "${username}"?`, async () => {
      try {
        await Client.v1.delUser(username);
        UI.toast('User removed', 'ok');
        _loadAll();
      } catch (e) {
        UI.toast(`Failed: ${e.message}`, 'err');
      }
    });
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { refresh, disconnect, remove };
})();
