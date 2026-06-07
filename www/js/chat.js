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

        const conversationId = payload.senderId; // Use senderId as conversation ID for peers
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
            sender: 'them',
            text: payload.text,
            timestamp: payload.timestamp || Date.now()
        };
        conv.messages.push(msg);

        // Increment unread if not currently open
        if (this.activeConversationId !== conversationId) {
            conv.unread = (conv.unread || 0) + 1;
            // Notify user via toast if not in chat view
            if (typeof showToast === 'function') {
                showToast(`New message from ${conv.name}`, 'info');
            }
        } else {
            // Append to active chat view immediately
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
            sender: 'me',
            text: text,
            timestamp: Date.now()
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
        const baseUrl = window.ENV?.GATEWAY_URL || '';
        
        if (conv.type === 'peer') {
            if (window.GossipService) {
                window.GossipService.sendChatMessage(conv.id, text);
            }
        } else if (conv.type === 'ai') {
            // Hook into Gateway AskEngine
            try {
                const res = await fetch(`${baseUrl}/api/v1/ask`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: text })
                });
                const data = await res.json();
                this.onMessageReceived({
                    senderId: conv.id,
                    senderName: conv.name,
                    text: data.result || data.error || "I processed your request.",
                    timestamp: Date.now()
                });
            } catch (e) {
                console.error("[AI] Chat Error:", e);
                this.onMessageReceived({
                    senderId: conv.id,
                    senderName: conv.name,
                    text: "Gateway AI is currently unavailable.",
                    timestamp: Date.now()
                });
            }
        } else if (conv.type === 'a2a') {
            // Hook into A2A Protocol via Gateway
            try {
                const res = await fetch(`${baseUrl}/a2a/${conv.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        type: 'TASK',
                        task: 'chat',
                        input: { message: text }
                    })
                });
                const data = await res.json();
                this.onMessageReceived({
                    senderId: conv.id,
                    senderName: conv.name,
                    text: data.output?.response || "Agent acknowledged.",
                    timestamp: Date.now()
                });
            } catch (e) {
                this.onMessageReceived({
                    senderId: conv.id,
                    senderName: conv.name,
                    text: "Agent communication failed.",
                    timestamp: Date.now()
                });
            }
        } else if (conv.type === 'channel') {
            // Send to external channel (WhatsApp/Telegram)
            try {
                await fetch(`${baseUrl}/api/v1/mobile/send`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        channel: conv.id.split(':')[0],
                        to: conv.id.split(':')[1],
                        text: text
                    })
                });
            } catch (e) {
                if (typeof UI !== 'undefined' && UI.error) UI.error("Failed to send to channel");
            }
        }
    },

    openConversation(id) {
        this.activeConversationId = id;
        const conv = this.conversations.find(c => c.id === id);
        if (!conv) return;

        conv.unread = 0;
        this.saveConversations();

        // Open Modal
        const modal = document.getElementById('chatBotModal');
        if (modal) {
            modal.style.display = 'flex'; // Or separate chat view
        }

        // Let's update the modal content
        const titleEl = document.querySelector('#chatBotModal h2');
        if (titleEl) titleEl.textContent = conv.name;

        // Clear existing log
        const log = document.getElementById('chatLog');
        if (log) {
            log.innerHTML = '';
            // Load history
            conv.messages.forEach(m => this.appendMessageToView(m));
            // Scroll to bottom
            log.scrollTop = log.scrollHeight;
        }

        // Show modal
        if (window.openChatBotModal && !modal.style.display) window.openChatBotModal();
    },

    appendMessageToView(msg) {
        const log = document.getElementById('chatLog');
        if (!log) return;

        const div = document.createElement('div');
        div.className = `chat-message ${msg.sender === 'me' ? 'sent' : 'received'}`;
        div.innerHTML = `
            <div class="message-content">
                <p>${msg.text}</p>
                <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
        `;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
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

    if (!CommunicationHub.conversations.find(c => c.id === 'nano-ai')) {
        CommunicationHub.conversations.push({
            id: 'nano-ai',
            name: 'Br3eze AI',
            type: 'ai',
            lastMessage: "How can I help you today?",
            timestamp: Date.now(),
            unread: 0,
            messages: []
        });
    }

    if (!CommunicationHub.conversations.find(c => c.id === 'network-admin')) {
        CommunicationHub.conversations.push({
            id: 'network-admin',
            name: 'Network Admin',
            type: 'a2a',
            lastMessage: "I am monitoring the mesh network.",
            timestamp: Date.now(),
            unread: 0,
            messages: []
        });
    }

    if (!CommunicationHub.conversations.find(c => c.id === 'financial-auditor')) {
        CommunicationHub.conversations.push({
            id: 'financial-auditor',
            name: 'Financial Auditor',
            type: 'a2a',
            lastMessage: "Ledger status: All clear.",
            timestamp: Date.now(),
            unread: 0,
            messages: []
        });
    }

    CommunicationHub.saveConversations();
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
