/**
 * AgentOS Hermes — ui.js
 * Modal · Toast · Confirm · small DOM utilities
 */
'use strict';

const UI = (() => {
  function openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
  }

  function closeModal(ev) {
    if (ev && ev.target !== ev.currentTarget) return;
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  function toast(msg, kind = 'inf', ms = 3200) {
    const root = document.getElementById('toast-root');
    const div = document.createElement('div');
    div.className = `toast toast-${kind}`;
    div.textContent = msg;
    root.appendChild(div);
    setTimeout(() => {
      div.style.opacity = '0';
      div.style.transition = 'opacity 0.2s';
      setTimeout(() => div.remove(), 200);
    }, ms);
  }

  function confirm(message, onYes) {
    openModal(
      'Confirm',
      `
      <p style="font-size:13px;color:var(--text);margin-bottom:16px;">${message}</p>
      <div class="modal-actions">
        <button class="modal-btn-cancel" onclick="UI.closeModal()">CANCEL</button>
        <button class="modal-btn-ok" id="confirm-yes">CONFIRM</button>
      </div>
    `
    );
    document.getElementById('confirm-yes').onclick = () => {
      closeModal();
      onYes();
    };
  }

  function toggleEye(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (inp.type === 'password') {
      inp.type = 'text';
      btn.textContent = '🙈';
    } else {
      inp.type = 'password';
      btn.textContent = '👁';
    }
  }

  return { openModal, closeModal, toast, confirm, toggleEye };
})();
