/**
 * AgentOS Hermes — users.js
 * Hotspot user lists: active sessions + all configured users
 */
'use strict';

const Users = (() => {

  async function refresh() {
    await Promise.all([_loadActive(), _loadAll()]);
  }

  function _renderUserCard(container, displayName, secondary, action, value) {
    const card = document.createElement('div');
    card.className = 'user-card';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'user-name';
    name.textContent = displayName;
    const meta = document.createElement('div');
    meta.className = action === 'disconnect' ? 'user-ip' : 'user-mac';
    meta.textContent = secondary;
    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'user-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kick-btn';
    button.textContent = action === 'disconnect' ? 'KICK' : 'DEL';
    button.addEventListener('click', () => action === 'disconnect' ? disconnect(value) : remove(value));
    actions.appendChild(button);
    card.append(info, actions);
    container.appendChild(card);
  }

  async function _loadActive() {
    const box = document.getElementById('active-users-list');
    box.textContent = 'Loading…';
    try {
      const res = await Client.v1.activeUsers();
      const users = res.data || [];
      box.replaceChildren();
      if (!users.length) { box.textContent = 'No active sessions.'; return; }
      users.forEach(u => _renderUserCard(
        box,
        u.user || u.username || u['.id'] || '?',
        `${u.address || '—'} · ${u.uptime || '—'}`,
        'disconnect',
        u['.id'] || u.id
      ));
    } catch (e) {
      box.textContent = `Failed: ${e?.message || 'Unable to load users'}`;
    }
  }

  async function _loadAll() {
    const box = document.getElementById('all-users-list');
    box.textContent = 'Loading…';
    try {
      const res = await Client.v1.allUsers();
      const users = res.data || [];
      box.replaceChildren();
      if (!users.length) { box.textContent = 'No users configured.'; return; }
      users.forEach(u => _renderUserCard(
        box,
        u.name || u.username || '?',
        u.profile || 'default',
        'remove',
        u.name || u.username
      ));
    } catch (e) {
      box.textContent = `Failed: ${e?.message || 'Unable to load users'}`;
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
      UI.toast(`Failed: ${e?.message || 'Disconnect failed'}`, 'err');
    }
  }

  async function remove(username) {
    if (!username) return;
    UI.confirm(`Delete user "${String(username)}"?`, async () => {
      try {
        await Client.v1.delUser(username);
        UI.toast('User removed', 'ok');
        _loadAll();
      } catch (e) {
        UI.toast(`Failed: ${e?.message || 'Delete failed'}`, 'err');
      }
    });
  }

  return { refresh, disconnect, remove };
})();
