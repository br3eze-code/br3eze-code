/* ==========================================================
   11.ai.bot.js — Gemini AI assistant chat
   Depends on: 01.ui.utils.js, 06.firebase.js
   ========================================================== */

// WARNING: Client-side API key — now loaded from .env
const GEMINI_API_KEY = window.ENV && window.ENV.GEMINI_API_KEY ? window.ENV.GEMINI_API_KEY : '';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// Chat history for contextual conversation
let _aiHistory = [];

window.openChatBotModal = function () {
    window.openModal('chatBoxModal');
};

window.sendChatMessage = async function () {
    const input = document.getElementById('aiChatInput');
    const msg   = input.value.trim();
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
    if (_aiHistory.length > 10) _aiHistory = _aiHistory.slice(-10); // keep last 10 turns

    try {
        const payload = {
            system_instruction: {
                parts: [{ text: `You are Br3eze, a friendly and knowledgeable support assistant for Power Connect — a Wi-Fi hotspot subscription service operating at br3eze.africa. Current user: ${window.currentUser?.fullname || 'Guest'}. Be concise, helpful, and professional.` }]
            },
            contents: _aiHistory
        };

        const res  = await fetch(GEMINI_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload)
        });

        const data  = await res.json();
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
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

// ── Smart Notifications & Insight Bridge ──────────────────
window.AIBridge = {
    analyzeUsage(plan) {
        if (!plan || !plan.expiresAt) return;
        
        // Example check: if running out of time
        const msLeft = plan.expiresAt.toMillis() - Date.now();
        if (msLeft > 0 && msLeft < 15 * 60 * 1000) { // Under 15 mins
            if (Math.random() > 0.95) { // Occasional popups to avoid spam
                if (typeof showToast === 'function') showToast("💡 AI Insight: You have less than 15 minutes left on your plan. Consider renewing soon to avoid interruption.", "info");
            }
        }
    },

    checkPlanHealth(plan) {
        if (!plan || !plan.expiresAt) return;

        const msLeft = plan.expiresAt.toMillis() - Date.now();
        
        // Notify at exactly 5 minutes remaining (approx)
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
};
