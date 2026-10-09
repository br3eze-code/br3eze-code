/* ==========================================================
   11.ai.bot.js — Gemini AI assistant + AgentOS ticket bridge
   Depends on: 01.ui.utils.js, 06.firebase.js
   ========================================================== */

// WARNING: A browser-side Gemini key is not a secret. Production deployments
// should proxy Gemini through a server-side AgentOS endpoint.
const GEMINI_API_KEY = window.ENV && window.ENV.GEMINI_API_KEY ? window.ENV.GEMINI_API_KEY : '';
const GEMINI_URL = GEMINI_API_KEY
    ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`
    : '';
const AGENTOS_TICKET_URL = window.ENV?.AGENTOS_TICKET_URL || '';
let _aiHistory = [];
window.openChatBotModal = function () { window.openModal('chatBoxModal'); };
function _requestId() { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); return `pwa-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function _ticketSource() { return { channel: 'pwa', application: 'br3eze', requestId: _requestId(), userId: window.currentUser?.uid || null }; }
function _emitTicketEvent(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
async function _createTicket(request, metadata = {}) {
    if (!request || typeof request !== 'string' || !request.trim()) throw new Error('A ticket request is required.');
    const payload = { source: _ticketSource(), request: request.trim(), metadata, user: { id: window.currentUser?.uid || null, name: window.currentUser?.fullname || 'Guest' } };
    if (window.AgentOS && typeof window.AgentOS.createTicket === 'function') { const result = await window.AgentOS.createTicket(payload); _emitTicketEvent('agentos:ticket-created', result); return result; }
    if (AGENTOS_TICKET_URL) {
        const response = await fetch(AGENTOS_TICKET_URL, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const text = await response.text(); let result;
        try { result = text ? JSON.parse(text) : {}; } catch (_) { result = { raw: text }; }
        if (!response.ok) throw new Error(result?.error || result?.message || `Ticket API returned ${response.status}`);
        _emitTicketEvent('agentos:ticket-created', result); return result;
    }
    const ticket = { id: `PWA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'queued-local', persisted: false, source: payload.source, request: payload.request, metadata: payload.metadata, user: payload.user, createdAt: new Date().toISOString() };
    _emitTicketEvent('agentos:ticket-created', ticket); return ticket;
}
window.AIBridge = window.AIBridge || {};
window.AIBridge.onTicketCreated = function (handler) { if (typeof handler !== 'function') return () => {}; const listener = event => handler(event.detail); window.addEventListener('agentos:ticket-created', listener); return () => window.removeEventListener('agentos:ticket-created', listener); };
window.AIBridge.createTicket = (request, metadata = {}) => _createTicket(request, metadata);
window.AIBridge.submitActionableRequest = (request, metadata = {}) => _createTicket(request, { ...metadata, actionable: true });

window.sendChatMessage = async function () {
    const input = document.getElementById('aiChatInput'); const msg = input.value.trim(); if (!msg) return;
    const box = document.getElementById('aiChatLog'); input.value = ''; _appendBubble(box, 'user', msg);
    const typing = document.createElement('div'); typing.className = 'chat-message bot'; typing.id = `typing-${Date.now()}`;
    const indicator = document.createElement('div'); indicator.className = 'bubble typing-indicator';
    for (let i = 0; i < 3; i += 1) indicator.appendChild(document.createElement('span'));
    typing.appendChild(indicator); box.appendChild(typing); box.scrollTop = box.scrollHeight;
    _aiHistory.push({ role: 'user', parts: [{ text: msg }] }); if (_aiHistory.length > 10) _aiHistory = _aiHistory.slice(-10);
    try {
        const payload = { system_instruction: { parts: [{ text: `You are Br3eze, a friendly and knowledgeable support assistant for Power Connect — a Wi-Fi hotspot subscription service operating at br3eze.africa. Current user: ${window.currentUser?.fullname || 'Guest'}. Be concise, helpful, and professional. Do not claim that a payment, order, ticket, refund, or account change was completed unless a backend response confirms it.` }] }, contents: _aiHistory };
        if (!GEMINI_URL) throw new Error('Gemini client endpoint is not configured.');
        const res = await fetch(GEMINI_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json(); if (!res.ok) throw new Error(data?.error?.message || `Gemini returned ${res.status}`);
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not process that. Please try again.';
        _aiHistory.push({ role: 'model', parts: [{ text: reply }] }); const typingEl = document.getElementById(typing.id); if (typingEl) typingEl.remove(); _appendBubble(box, 'bot', reply);
    } catch (e) { const typingEl = document.getElementById(typing.id); if (typingEl) typingEl.remove(); _appendBubble(box, 'bot', '⚠️ Error connecting to AI assistant. Check your connection.', true); console.error('[AI] sendChatMessage error:', e); }
    box.scrollTop = box.scrollHeight;
};

function _appendBubble(box, role, text, isError = false) {
    const div = document.createElement('div'); div.className = `chat-message ${role}`;
    const bubble = document.createElement('div'); bubble.className = `bubble${isError ? ' error-bubble' : ''}`; bubble.textContent = String(text == null ? '' : text);
    div.appendChild(bubble); box.appendChild(div);
}

Object.assign(window.AIBridge, {
    analyzeUsage(plan) {
        if (!plan || !plan.expiresAt) return; const expiresAt = typeof plan.expiresAt.toMillis === 'function' ? plan.expiresAt.toMillis() : new Date(plan.expiresAt).getTime(); const msLeft = expiresAt - Date.now();
        if (msLeft > 0 && msLeft < 15 * 60 * 1000 && Math.random() > 0.95 && typeof showToast === 'function') showToast('💡 AI Insight: You have less than 15 minutes left on your plan. Consider renewing soon to avoid interruption.', 'info');
    },
    checkPlanHealth(plan) {
        if (!plan || !plan.expiresAt) return; const expiresAt = typeof plan.expiresAt.toMillis === 'function' ? plan.expiresAt.toMillis() : new Date(plan.expiresAt).getTime(); const msLeft = expiresAt - Date.now();
        if (msLeft > 0 && msLeft <= 5 * 60 * 1000 && !plan._notified5Min) { plan._notified5Min = true; if (window.NotificationManager && typeof window.NotificationManager.send === 'function') window.NotificationManager.send({ id: 505, title: 'Plan Expiring Soon', text: 'You have less than 5 minutes remaining on your Wi-Fi plan.' }); }
    }
});
