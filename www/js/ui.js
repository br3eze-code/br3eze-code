/**
 * AgentOS Hermes — ui.js
 * Modal · Toast · Confirm · small DOM utilities
 */
'use strict';

const UI = (() => {

  function openModal(title, bodyHtml) {
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    if (titleEl) titleEl.textContent = title == null ? '' : String(title);
    if (bodyEl) bodyEl.innerHTML = bodyHtml == null ? '' : String(bodyHtml);
    document.getElementById('modal-overlay')?.classList.remove('hidden');
  }

  function closeModal(ev) {
    if (ev && ev.target !== ev.currentTarget) return;
    document.getElementById('modal-overlay')?.classList.add('hidden');
  }

  function toast(msg, kind = 'inf', ms = 3200) {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const div = document.createElement('div');
    div.className = 'toast toast-' + String(kind).replace(/[^a-z0-9_-]/gi, '');
    div.textContent = msg == null ? '' : String(msg);
    root.appendChild(div);
    setTimeout(() => {
      div.style.opacity = '0';
      div.style.transition = 'opacity 0.2s';
      setTimeout(() => div.remove(), 200);
    }, ms);
  }

  function confirm(message, onYes) {
    const overlay = document.getElementById('modal-overlay');
    const title = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    if (!overlay || !body) return;

    if (title) title.textContent = 'Confirm';
    body.replaceChildren();

    const p = document.createElement('p');
    p.className = 'confirm-message';
    p.style.cssText = 'font-size:13px;color:var(--text);margin-bottom:16px;';
    p.textContent = message == null ? '' : String(message);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'modal-btn-cancel';
    cancel.textContent = 'CANCEL';
    cancel.addEventListener('click', closeModal);

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'modal-btn-ok';
    ok.id = 'confirm-yes';
    ok.textContent = 'CONFIRM';
    ok.addEventListener('click', () => {
      closeModal();
      if (typeof onYes === 'function') onYes();
    }, { once: true });

    actions.append(cancel, ok);
    body.append(p, actions);
    overlay.classList.remove('hidden');
  }

  function toggleEye(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp || !btn) return;
    if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
    else { inp.type = 'password'; btn.textContent = '👁'; }
  }

  return { openModal, closeModal, toast, confirm, toggleEye };
})();
