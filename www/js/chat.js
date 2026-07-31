/* ==========================================================
   FILE: chat.js
   DESCRIPTION: CommunicationHub and Chat UI Logic
   ========================================================== */

// HTML Escape Utility
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const CommunicationHub = {
    conversations: [], // { id, name, type: 'peer'|'ai'|'system', lastMessage, timestamp, unread, avatar?, messages: [] }
    activeConversationId: null,

    init() {
        this.loadConversations();
        console.log("[CommunicationHub] Initialized. Loaded conversations:", this.conversations.length);
        // Expose globally
        window.CommunicationHub = this;
    },

    loadConversations() {
        const stored = localStorage.getItem('chat_conversations');
        if (stored) {
            try {
                this.conversations = JSON.parse(stored);
            } catch (e) {
                console.error("[CommunicationHub] Failed to parse conversations", e);
                this.conversations = [];
            }
        }
    },

    saveConversations() {
        localStorage.setItem('chat_conversations', JSON.stringify(this.conversations));
        this.renderChats();
    },

    // Called by nearby.js (Mesh) or app.js (AI/System)
    onMessageReceived(payload) {
        // payload: { senderId, senderName, text, timestamp, isMesh, ... }
        console.log("[CommunicationHub] Incoming:", payload);

        // Messages relayed from the chat modal (window.addMessage) carry a
        // targetId — file them under that conversation. Own messages must not
        // fire unread/toast.
        const isOwnMessage = payload.sender === 'user' || payload.sender === 'me';
        const conversationId = payload.targetId || payload.senderId;
        let conv = this.conversations.find(c => c.id === conversationId);

        if (!conv) {
            conv = {
                id: conversationId,
                name: payload.senderName || "Unknown Peer",
                type: 'peer',
                lastMessage: payload.text,
                timestamp: payload.timestamp || Date.now(),
                unread: 0,
                messages: []
            };
            this.conversations.unshift(conv);
        } else {
            // Move to top
            this.conversations = this.conversations.filter(c => c.id !== conversationId);
            this.conversations.unshift(conv);

            conv.lastMessage = payload.text;
            conv.timestamp = payload.timestamp || Date.now();
        }

        // Add message to internal history
        const msg = {
            id: payload.id || ('m' + Date.now() + Math.random().toString(36).slice(2, 6)),
            sender: isOwnMessage ? 'me' : 'them',
            text: payload.text,
            timestamp: payload.timestamp || Date.now()
        };
        conv.messages.push(msg);

        // An inbound peer message means they're actively on this thread, so
        // everything I sent them is now read (WhatsApp blue ticks).
        if (!isOwnMessage) this.markMyMessagesRead(conversationId);

        // Increment unread if not currently open (never for our own messages)
        if (!isOwnMessage && this.activeConversationId !== conversationId) {
            conv.unread = (conv.unread || 0) + 1;
            // Notify user via toast if not in chat view
            if (typeof showToast === 'function') {
                showToast(`New message from ${conv.name}`, 'info');
            }
        } else if (!payload.rendered) {
            // Append to active chat view immediately (unless the caller —
            // window.addMessage — already drew this bubble itself)
            this.appendMessageToView(msg);
        }

        this.saveConversations();
        this.renderChats(); // Update list in background
    },

    async sendMessage(text) {
        if (!this.activeConversationId) return;

        const conv = this.conversations.find(c => c.id === this.activeConversationId);
        if (!conv) return;

        const msg = {
            id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
            sender: 'me',
            text: text,
            timestamp: Date.now(),
            status: 'sending' // sending → sent → delivered → read (WhatsApp-style)
        };
        conv.messages.push(msg);
        conv.lastMessage = "You: " + text;
        conv.timestamp = Date.now();

        // Move to top
        this.conversations = this.conversations.filter(c => c.id !== this.activeConversationId);
        this.conversations.unshift(conv);

        this.saveConversations();
        this.appendMessageToView(msg);

        // Dispatch to network
        if (conv.type === 'peer') {
            if (window.GossipService) {
                window.GossipService.sendChatMessage(conv.id, text);
                // Sent to the mesh; mark delivered if the peer is currently seen.
                this.updateMessageStatus(conv.id, msg.id, 'sent');
                const online = window.GossipService.peers && window.GossipService.peers.has(conv.id);
                if (online) setTimeout(() => this.updateMessageStatus(conv.id, msg.id, 'delivered'), 400);
            }
        } else if (conv.type === 'ai') {
            // Hook into Real AI
            if (window.aiOrchestrator) {
                try {
                    const response = await window.aiOrchestrator.generateText(text);
                    this.onMessageReceived({
                        senderId: conv.id,
                        senderName: conv.name,
                        text: response,
                        timestamp: Date.now()
                    });

                    // 🚀 DELEGATION: AI takes action if intent is clear
                    if (window.NanoAI && window.NanoAI.detectIntent) {
                        const intentResult = window.NanoAI.detectIntent(text);
                        if (intentResult && intentResult.confidence > 0.8) {
                            console.log(`[AI Delegation] Intent: ${intentResult.intent}`);
                            if (window.AppBridge && window.AppBridge.suggestAction) {
                                await window.AppBridge.suggestAction(intentResult.intent);
                            }
                        }
                    }
                } catch (e) {
                    console.error("[AI] Chat Error:", e);
                    this.onMessageReceived({
                        senderId: conv.id,
                        senderName: conv.name,
                        text: "I'm having trouble thinking right now. Please try again.",
                        timestamp: Date.now()
                    });
                }
            } else {
                console.warn("[AI] Orchestrator not found");
            }
        } else {
            console.warn("[AI] Orchestrator not found");
        }
    },

    openConversation(id) {
        this.activeConversationId = id;
        const conv = this.conversations.find(c => c.id === id);
        if (!conv) return;

        conv.unread = 0;
        this.saveConversations();

        // Use global consolidation function
        if (window.openChatBotModal) {
            window.openChatBotModal({
                type: conv.type === 'ai' ? 'AI' : 'peer',
                targetId: id,
                name: conv.name
            });
        }
    },

    renderConversation(id) {
        const conv = this.conversations.find(c => c.id === id);
        if (!conv) return;

        const log = document.getElementById('chatLog');
        if (log) {
            log.innerHTML = '';
            conv.messages.forEach(m => this.appendMessageToView(m));
            log.scrollTop = log.scrollHeight;
        }
    },

    // WhatsApp-style delivery ticks for own messages.
    _statusTick(status) {
        switch (status) {
            case 'sending': return '<i class="fas fa-clock" title="Sending"></i>';
            case 'sent': return '<i class="fas fa-check" title="Sent"></i>';
            case 'delivered': return '<i class="fas fa-check-double" title="Delivered"></i>';
            case 'read': return '<i class="fas fa-check-double" style="color:#53bdeb;" title="Read"></i>';
            default: return '';
        }
    },

    appendMessageToView(msg) {
        const log = document.getElementById('chatLog');
        if (!log) return;

        const isMe = msg.sender === 'me';
        const conv = this.conversations.find(c => c.id === this.activeConversationId);
        const isAI = conv && conv.type === 'ai';
        const div = document.createElement('div');
        div.className = `chat-message ${isMe ? 'user' : 'bot'}`;
        if (msg.id) div.dataset.msgId = msg.id;

        const safeText = msg.text.includes('<div') ? msg.text : escapeHtml(msg.text);
        const avatarIcon = isAI ? 'fa-robot' : 'fa-user';
        const tick = isMe ? `<span class="msg-tick" style="margin-left:4px;">${this._statusTick(msg.status || 'sent')}</span>` : '';

        div.innerHTML = `
            ${!isMe ? `<div class="bot-avatar"><i class="fas ${avatarIcon}"></i></div>` : ''}
            <div class="bubble ${isMe ? 'user' : 'bot'}">
                ${safeText}
                <div style="font-size: 0.65rem; opacity: 0.6; margin-top: 5px; text-align: ${isMe ? 'right' : 'left'}">
                    ${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${tick}
                </div>
            </div>
        `;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    },

    // Update a message's delivery status in memory + in the open thread.
    updateMessageStatus(convId, msgId, status) {
        const order = { sending: 0, sent: 1, delivered: 2, read: 3 };
        const conv = this.conversations.find(c => c.id === convId);
        if (conv) {
            const m = conv.messages.find(x => x.id === msgId);
            // Never regress status (a late 'delivered' must not overwrite 'read').
            if (m && (order[status] ?? 0) >= (order[m.status] ?? 0)) m.status = status;
            this.saveConversations();
        }
        if (this.activeConversationId === convId) {
            const el = document.querySelector(`#chatLog .chat-message[data-msg-id="${msgId}"] .msg-tick`);
            if (el) el.innerHTML = this._statusTick(status);
        }
    },

    // Mark all of MY messages in a conversation as read (peer opened / replied).
    markMyMessagesRead(convId) {
        const conv = this.conversations.find(c => c.id === convId);
        if (!conv) return;
        let changed = false;
        conv.messages.forEach(m => { if (m.sender === 'me' && m.status !== 'read') { m.status = 'read'; changed = true; } });
        if (changed) {
            this.saveConversations();
            if (this.activeConversationId === convId) {
                document.querySelectorAll('#chatLog .chat-message.user .msg-tick').forEach(el => { el.innerHTML = this._statusTick('read'); });
            }
        }
    },

    renderChats() {
        const container = document.getElementById('chatsListContainer');
        if (!container) return;

        if (this.conversations.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comments" style="font-size: 3rem; color: var(--color-text-muted);"></i>
                    <p>No conversations yet.</p>
                </div>`;
            return;
        }

        container.innerHTML = '';
        this.conversations.forEach(c => {
            const el = document.createElement('div');
            el.className = 'chat-item';
            el.onclick = () => this.openConversation(c.id);
            el.innerHTML = `
                <div class="chat-avatar">
                   <i class="fas ${c.type === 'ai' ? 'fa-robot' : 'fa-user'}"></i>
                </div>
                <div class="chat-info">
                    <div class="chat-header">
                        <h4>${c.name}</h4>
                        <span class="chat-time">${this.formatTime(c.timestamp)}</span>
                    </div>
                    <div class="chat-body">
                        <p>${c.lastMessage}</p>
                        ${c.unread > 0 ? `<span class="badge badge-error">${c.unread}</span>` : ''}
                    </div>
                </div>
            `;
            container.appendChild(el);
        });
    },

    formatTime(ts) {
        const date = new Date(ts);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
};

// --- CHATS UI LOGIC (Integrated) ---

function renderChatsSection() {
    const container = document.getElementById('chatsListContainer');
    if (!container) return;

    // Grouping is handled by CommunicationHub.conversations already
    const sortedConvos = [...CommunicationHub.conversations].sort((a, b) => b.timestamp - a.timestamp);

    if (sortedConvos.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-comments" style="font-size: 3rem; color: var(--color-text-muted);"></i>
                <p>No recent conversations.</p>
                <button class="btn btn-sm" onclick="window.openChatBotModal()">Start New Chat</button>
            </div>`;
        return;
    }

    let html = '';
    sortedConvos.forEach(chat => {
        const isBot = chat.id === 'nano-ai' || chat.id === 'AI_ASSISTANT';
        const isSystem = chat.id === 'SYSTEM';

        let avatarIcon = chat.type === 'ai' ? 'fa-robot' : 'fa-user';
        let avatarColor = 'var(--color-primary)';
        let statusClass = 'status-offline';
        let title = chat.name || chat.id;

        if (isBot) {
            avatarIcon = 'fa-robot';
            avatarColor = '#9b59b6';
            statusClass = 'status-online';
        } else if (isSystem) {
            avatarIcon = 'fa-bell';
            avatarColor = '#f39c12';
            statusClass = '';
        } else {
            if (window.GossipService && GossipService.peers.has(chat.id)) {
                statusClass = 'status-online';
            }
        }

        html += `
        <div class="chat-item" onclick="CommunicationHub.openConversation('${chat.id}')">
            <div class="chat-avatar-container">
                <div class="chat-avatar" style="background: ${avatarColor}">
                    <i class="fas ${avatarIcon}"></i>
                </div>
                ${statusClass ? `<div class="chat-status-indicator ${statusClass}"></div>` : ''}
            </div>
            <div class="chat-info">
                <div class="chat-header">
                    <span class="chat-name">${escapeHtml(title)}</span>
                    <span class="chat-time">${CommunicationHub.formatTime(chat.timestamp)}</span>
                </div>
                <div class="chat-preview">
                    ${escapeHtml(chat.lastMessage)}
                </div>
                ${chat.unread > 0 ? `<span class="unread-badge">${chat.unread}</span>` : ''}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// Hook into showSection
const originalShowSection = window.showSection;
window.showSection = function (sectionId) {
    if (originalShowSection) originalShowSection(sectionId);
    if (sectionId === 'chats') {
        document.querySelectorAll('.dashboard-section').forEach(el => el.classList.add('hidden'));
        const sec = document.getElementById('chats-section');
        if (sec) sec.classList.remove('hidden');
        renderChatsSection();
    }
};

// Initialize after DOM load
document.addEventListener('DOMContentLoaded', () => {
    CommunicationHub.init();
    renderChatsSection();

    if (!CommunicationHub.conversations.find(c => c.type === 'ai')) {
        CommunicationHub.conversations.push({
            id: 'nano-ai',
            name: 'Br3eze AI',
            type: 'ai',
            lastMessage: "How can I help you today?",
            timestamp: Date.now(),
            unread: 0,
            messages: []
        });
        CommunicationHub.saveConversations();
    }
});

window.renderChatsSection = renderChatsSection;
window.openConversation = (id) => CommunicationHub.openConversation(id);
window.filterChats = () => {
    const input = document.getElementById('chatSearchInput');
    const filter = input.value.toLowerCase();
    const items = document.querySelectorAll('.chat-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(filter) ? 'flex' : 'none';
    });
};

window.sendChatMessage = () => {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (text) {
        CommunicationHub.sendMessage(text);
        input.value = '';
    }
};

// VoIP Trigger Mock
window.initiateVoIPCall = (type, userId) => {
    console.log(`[VoIP] Starting ${type} call to ${userId}`);
    showToast(`Calling... (${type})`, 'info');
    // In real implementation, this interacts with Cordova/WebRTC
    // window.GossipService.sendCallSignal(...)
};
