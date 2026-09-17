/* ==========================================================
   10.messages.js — P2P chat hub, support tickets
   Depends on: 01.ui.utils.js, 06.firebase.js
   ========================================================== */

let _currentChatUserId = null;

function _text(value, fallback = '') {
    return value == null || value === '' ? fallback : String(value);
}

function _makeChatItem(uid, name) {
    const item = document.createElement('div');
    item.className = 'chat-hub-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.addEventListener('click', () => window.openUnifiedChat(uid, name));
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.openUnifiedChat(uid, name); } });

    const avatar = document.createElement('div');
    avatar.className = 'chat-hub-avatar';
    avatar.textContent = name.charAt(0).toUpperCase() || '?';
    const info = document.createElement('div');
    info.className = 'chat-hub-info';
    const title = document.createElement('span');
    title.className = 'chat-hub-name';
    title.textContent = name;
    const preview = document.createElement('span');
    preview.className = 'chat-hub-preview';
    preview.textContent = 'Tap to chat';
    info.append(title, preview);
    item.append(avatar, info);
    return item;
}

function _makeTicketItem(ticket) {
    const item = document.createElement('div');
    item.className = 'chat-hub-item';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.addEventListener('click', () => window.openTicketDetail(ticket.id));
    item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.openTicketDetail(ticket.id); } });
    const info = document.createElement('div');
    info.className = 'chat-hub-info';
    const title = document.createElement('span');
    title.className = 'chat-hub-name';
    title.textContent = _text(ticket.subject, 'Untitled ticket');
    const status = document.createElement('span');
    status.className = 'chat-hub-preview';
    status.textContent = _text(ticket.status, 'Unknown');
    info.append(title, status);
    item.appendChild(info);
    return item;
}

// ── Render chat list + ticket list ──────────────────────────
async function renderMessages() {
    try {
        const users = await window.DataStore.getAllUsers();
        const chatList = document.getElementById('chatListContainer');
        if (chatList) {
            chatList.replaceChildren();
            users.filter(u => u.id !== window.currentUser.id).forEach(u => {
                const name = _text(u.fullname, 'Anonymous User');
                chatList.appendChild(_makeChatItem(_text(u.id), name));
            });
        }

        const tickets = await window.DataStore.getTickets();
        const ticketList = document.getElementById('ticketListContainer');
        if (ticketList) {
            ticketList.replaceChildren();
            if (tickets.length) tickets.forEach(t => ticketList.appendChild(_makeTicketItem(t)));
            else {
                const empty = document.createElement('p');
                empty.style.cssText = 'padding:10px;opacity:.6';
                empty.textContent = 'No tickets yet.';
                ticketList.appendChild(empty);
            }
        }
    } catch (e) {
        console.error('[Messages] renderMessages error:', e);
        showToast('Failed to load messages.', 'error');
    }
}

window.handleNewChatClick = function () {
    window.openModal('contactPickerModal');
    const src = document.getElementById('chatListContainer');
    const dest = document.getElementById('contactListContainer');
    if (src && dest) dest.replaceChildren(...Array.from(src.children).map(node => node.cloneNode(true)));
};

window.openUnifiedChat = function (uid, name) {
    _currentChatUserId = uid;
    const safeName = _text(name, 'User');
    const headerName = document.getElementById('chatHeaderName');
    const headerAvatar = document.getElementById('chatHeaderAvatar');
    if (headerName) headerName.textContent = safeName;
    if (headerAvatar) headerAvatar.textContent = safeName.charAt(0).toUpperCase() || '?';
    document.getElementById('chatLog')?.replaceChildren();
    window.openModal('unifiedChatModal');
    window.closeModal('contactPickerModal');
};

window.toggleChatMenu = function () {
    const menu = document.getElementById('chatMenuDropdown');
    if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
};
window.clearChatHistory = function () {
    document.getElementById('chatLog')?.replaceChildren();
    window.toggleChatMenu();
};
window.blockUser = function () {
    showToast('User blocked.', 'info');
    window.toggleChatMenu();
    window.closeModal('unifiedChatModal');
};
window.openUserProfile = function () {
    window.openModal('userProfileModal');
    const name = document.getElementById('chatHeaderName')?.textContent || 'User';
    document.getElementById('profileModalName').textContent = name;
    document.getElementById('profileModalHandle').textContent = '@' + _text(_currentChatUserId);
};

function _appendMessage(container, message, isUser) {
    const row = document.createElement('div');
    row.className = `chat-message ${isUser ? 'user' : 'bot'}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = _text(message);
    row.appendChild(bubble);
    container.appendChild(row);
}

window.openTicketDetail = async function (tid) {
    Loading.show('Loading...');
    try {
        const tickets = await window.DataStore.getTickets();
        const ticket = tickets.find(t => t.id === tid);
        if (!ticket) throw new Error('Ticket not found.');
        const replies = await window.DataStore.getTicketReplies(tid);

        document.getElementById('ticketModalTitle').textContent = _text(ticket.subject, 'Ticket');
        document.getElementById('ticketModalStatus').textContent = _text(ticket.status, 'Unknown');
        document.getElementById('currentTicketId').value = tid;
        document.getElementById('ticketModalSubtitle').textContent = ticket.timestamp
            ? `Opened: ${new Date(ticket.timestamp.seconds * 1000).toLocaleDateString()}` : '';

        const container = document.getElementById('ticketRepliesContainer');
        container.replaceChildren();
        _appendMessage(container, ticket.body, false);
        replies.forEach(r => _appendMessage(container, r.message, r.senderId === window.currentUser.id));
        container.scrollTop = container.scrollHeight;
        window.openModal('ticketDetailModal');
    } catch (e) {
        showToast(_text(e?.message, 'Unable to open ticket.'), 'error');
    } finally {
        Loading.hide();
    }
};

window.openSubmitTicketModal = function () { window.openModal('submitTicketModal'); };

window._handleNewTicket = async function (e) {
    e.preventDefault();
    Loading.show('Submitting...');
    try {
        await db.collection('tickets').add({
            userId: window.currentUser.id,
            userEmail: window.currentUser.email,
            subject: document.getElementById('newTicketSubject').value,
            body: document.getElementById('newTicketBody').value,
            status: 'Open',
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        window.closeModal('submitTicketModal');
        renderMessages();
        showToast('Ticket submitted!', 'success');
    } catch (e) {
        showToast(_text(e?.message, 'Unable to submit ticket.'), 'error');
    } finally {
        Loading.hide();
    }
};

window._handleTicketReply = async function (e) {
    e.preventDefault();
    const tid = document.getElementById('currentTicketId').value;
    const msg = document.getElementById('ticketReplyInput').value.trim();
    if (!msg) return;
    try {
        await db.collection('tickets').doc(tid).collection('replies').add({
            senderId: window.currentUser.id,
            message: msg,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        document.getElementById('ticketReplyInput').value = '';
        window.openTicketDetail(tid);
    } catch (e) {
        showToast(_text(e?.message, 'Unable to send reply.'), 'error');
    }
};
