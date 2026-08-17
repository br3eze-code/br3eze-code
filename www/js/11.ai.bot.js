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

// Optional server-side ticket endpoint. This is intentionally configurable
// because the PHP route catalogue does not currently expose /tickets.
const AGENTOS_TICKET_URL = window.ENV?.AGENTOS_TICKET_URL || '';

// Chat history for contextual conversation
let _aiHistory = [];

window.openChatBotModal = function () {
    window.openModal('chatBoxModal');
};

function _requestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `pwa-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function _ticketSource() {
    return {
        channel: 'pwa',
        application: 'br3eze',
        requestId: _requestId(),
        userId: window.currentUser?.uid || null
    };
}

function _emitTicketEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Submit actionable PWA work to AgentOS.
 *
 * Priority order:
 *  1. Existing AgentOS client bridge, when present.
 *  2. Explicit AGENTOS_TICKET_URL, when configured.
 *  3. Local dashboard event fallback (never claims server persistence).
 */
async function _createTicket(request, metadata = {}) {
    if (!request || typeof request !== 'string' || !request.trim()) {
        throw new Error('A ticket request is required.');
    }

    const payload = {
        source: _ticketSource(),
        request: request.trim(),
        metadata,
        user: {
            id: window.currentUser?.uid || null,
            name: window.currentUser?.fullname || 'Guest'
        }
    };

    if (window.AgentOS && typeof window.AgentOS.createTicket === 'function') {
        const result = await window.AgentOS.createTicket(payload);
        _emitTicketEvent('agentos:ticket-created', result);
        return result;
    }

    if (AGENTOS_TICKET_URL) {
        const response = await fetch(AGENTOS_TICKET_URL, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        let result;
        try {
            result = text ? JSON.parse(text) : {};
        } catch (_) {
            result = { raw: text };
        }

        if (!response.ok) {
            throw new Error(result?.error || result?.message || `Ticket API returned ${response.status}`);
        }

        _emitTicketEvent('agentos:ticket-created', result);
        return result;
    }

    // Safe local fallback for offline/PWA dashboard operation.
    const ticket = {
        id: `PWA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'queued-local',
        persisted: false,
        source: payload.source,
        request: payload.request,
        metadata: payload.metadata,
        user: payload.user,
        createdAt: new Date().toISOString()
    };

    _emitTicketEvent('agentos:ticket-created', ticket);
    return ticket;
}

window.AIBridge = window.AIBridge || {};

// Dashboard integration: listen for tickets created by the PWA bot.
window.AIBridge.onTicketCreated = function (handler) {
    if (typeof handler !== 'function') return () => {};
    const listener = event => handler(event.detail);
    window.addEventListener('agentos:ticket-created', listener);
    return () => window.removeEventListener('agentos:ticket-created', listener);
};

window.AIBridge.createTicket = function (request, metadata = {}) {
    return _createTicket(request, metadata);
};

window.AIBridge.submitActionableRequest = function (request, metadata = {}) {
    return _createTicket(request, { ...metadata, actionable: true });
};

window.sendChatMessage = async function () {
    const input = document.getElementById('aiChatInput');
    const msg = input.value.trim();
    if (!msg) return;

    const box = document.getElementById('aiChatLog');
    input.value = '';

    // Render user bubble
    _appendBubble(box, 'user', msg);

    // Typing indicator
    const typingId = 'typing-' + Date.now();
    box.innerHTML += `<div class="chat-message bot" id="${typingId}">
        <div class="bubble typing-indicator"><span></span><span></span><span></span></div>
    </div>`;
    box.scrollTop = box.scrollHeight;

    // Build context-aware history
    _aiHistory.push({ role: 'user', parts: [{ text: msg }] });
    if (_aiHistory.length > 10) _aiHistory = _aiHistory.slice(-10);

    try {
        const payload = {
            system_instruction: {
                parts: [{ text: `You are Br3eze, a friendly and knowledgeable support assistant for Power Connect — a Wi-Fi hotspot subscription service operating at br3eze.africa. Current user: ${window.currentUser?.fullname || 'Guest'}. Be concise, helpful, and professional. Do not claim that a payment, order, ticket, refund, or account change was completed unless a backend response confirms it.` }]
            },
            contents: _aiHistory
        };

        if (!GEMINI_URL) {
            throw new Error('Gemini client endpoint is not configured.');
        }

        const res = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data?.error?.message || `Gemini returned ${res.status}`);
        }

        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text
            || 'Sorry, I could not process that. Please try again.';

        // Add assistant response to history
        _aiHistory.push({ role: 'model', parts: [{ text: reply }] });

        // Replace typing indicator
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        _appendBubble(box, 'bot', reply);

    } catch (e) {
        const typingEl = document.getElementById(typingId);
        if (typingEl) typingEl.remove();
        _appendBubble(box, 'bot', '⚠️ Error connecting to AI assistant. Check your connection.', true);
        console.error('[AI] sendChatMessage error:', e);
    }

    box.scrollTop = box.scrollHeight;
};

function _appendBubble(box, role, text, isError = false) {
    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    div.innerHTML = `<div class="bubble${isError ? ' error-bubble' : ''}">${_sanitize(text)}</div>`;
    box.appendChild(div);
}

function _sanitize(str) {
    // Basic XSS prevention + markdown-lite (bold, newlines)
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

// ── Smart Notifications & Insight Bridge ──────────────────
Object.assign(window.AIBridge, {
    analyzeUsage(plan) {
        if (!plan || !plan.expiresAt) return;

        const expiresAt = typeof plan.expiresAt.toMillis === 'function'
            ? plan.expiresAt.toMillis()
            : new Date(plan.expiresAt).getTime();
        const msLeft = expiresAt - Date.now();

        if (msLeft > 0 && msLeft < 15 * 60 * 1000) {
            if (Math.random() > 0.95) {
                if (typeof showToast === 'function') showToast("💡 AI Insight: You have less than 15 minutes left on your plan. Consider renewing soon to avoid interruption.", "info");
            }
        }
    },

    checkPlanHealth(plan) {
        if (!plan || !plan.expiresAt) return;

        const expiresAt = typeof plan.expiresAt.toMillis === 'function'
            ? plan.expiresAt.toMillis()
            : new Date(plan.expiresAt).getTime();
        const msLeft = expiresAt - Date.now();

        if (msLeft > 0 && msLeft <= 5 * 60 * 1000 && !plan._notified5Min) {
            plan._notified5Min = true;
            if (window.NotificationManager && typeof window.NotificationManager.send === 'function') {
                window.NotificationManager.send({
                    id: 505,
                    title: 'Plan Expiring Soon',
                    text: 'You have less than 5 minutes remaining on your Wi-Fi plan.'
                });
            }
        }
    }
});
