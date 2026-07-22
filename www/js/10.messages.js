/* ==========================================================
   10.messages.js — P2P chat hub, support tickets
   Depends on: 01.ui.utils.js, 06.firebase.js
   ========================================================== */

let _currentChatUserId = null;

// ── Render chat list + ticket list ──────────────────────────
async function renderMessages() {
    try {
        // P2P contact list
        const users    = await window.DataStore.getAllUsers();
        const chatList = document.getElementById('chatListContainer');
        if (chatList) {
            chatList.innerHTML = users
                .filter(u => u.id !== window.currentUser.id)
                .map(u => `
                    <div class="chat-hub-item" onclick="openUnifiedChat('${u.id}','${u.fullname || 'User'}')">
                        <div class="chat-hub-avatar">${u.fullname ? u.fullname[0].toUpperCase() : '?'}</div>
                        <div class="chat-hub-info">
                            <span class="chat-hub-name">${u.fullname || 'Anonymous User'}</span>
                            <span class="chat-hub-preview">Tap to chat</span>
                        </div>
                    </div>
                `).join('');
        }

        // Ticket list
        const tickets    = await window.DataStore.getTickets();
        const ticketList = document.getElementById('ticketListContainer');
        if (ticketList) {
            ticketList.innerHTML = tickets.length
                ? tickets.map(t => `
                    <div class="chat-hub-item" onclick="openTicketDetail('${t.id}')">
                        <div class="chat-hub-info">
                            <span class="chat-hub-name">${t.subject}</span>
                            <span class="chat-hub-preview">${t.status}</span>
                        </div>
                    </div>
                `).join('')
                : '<p style="padding:10px;opacity:.6">No tickets yet.</p>';
        }
    } catch (e) {
        console.error('[Messages] renderMessages error:', e);
        showToast('Failed to load messages.', 'error');
    }
}

// ── New chat button ─────────────────────────────────────────
window.handleNewChatClick = function () {
    window.openModal('contactPickerModal');
    const src  = document.getElementById('chatListContainer');
    const dest = document.getElementById('contactListContainer');
    if (src && dest) dest.innerHTML = src.innerHTML;
};

// ── Open P2P chat window ────────────────────────────────────
window.openUnifiedChat = function (uid, name) {
    _currentChatUserId = uid;
    document.getElementById('chatHeaderName').innerText   = name;
    document.getElementById('chatHeaderAvatar').innerText = name[0];
    document.getElementById('chatLog').innerHTML          = '';
    window.openModal('unifiedChatModal');
    window.closeModal('contactPickerModal');
};

// ── Chat menu actions ───────────────────────────────────────
window.toggleChatMenu = function () {
    const menu = document.getElementById('chatMenuDropdown');
    if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
};
window.clearChatHistory = function () {
    const log = document.getElementById('chatLog');
    if (log) log.innerHTML = '';
    window.toggleChatMenu();
};
window.blockUser = function () {
    showToast('User blocked.', 'info');
    window.toggleChatMenu();
    window.closeModal('unifiedChatModal');
};
window.openUserProfile = function () {
    window.openModal('userProfileModal');
    document.getElementById('profileModalName').textContent   = document.getElementById('chatHeaderName').innerText;
    document.getElementById('profileModalHandle').textContent = '@' + _currentChatUserId;
};

// ── Support ticket: detail view ─────────────────────────────
window.openTicketDetail = async function (tid) {
    Loading.show('Loading...');
    try {
        const tickets = await window.DataStore.getTickets();
        const ticket  = tickets.find(t => t.id === tid);
        if (!ticket) throw new Error('Ticket not found.');

        const replies = await window.DataStore.getTicketReplies(tid);

        document.getElementById('ticketModalTitle').innerText    = ticket.subject;
        document.getElementById('ticketModalStatus').innerText   = ticket.status;
        document.getElementById('currentTicketId').value         = tid;
        document.getElementById('ticketModalSubtitle').innerText =
            `Opened: ${ticket.timestamp ? new Date(ticket.timestamp.seconds * 1000).toLocaleDateString() : ''}`;

        const container = document.getElementById('ticketRepliesContainer');
        container.innerHTML = `<div class="chat-message bot"><div class="bubble">${ticket.body}</div></div>`;

        replies.forEach(r => {
            const cls = r.senderId === window.currentUser.id ? 'user' : 'bot';
            container.innerHTML += `<div class="chat-message ${cls}"><div class="bubble">${r.message}</div></div>`;
        });

        container.scrollTop = container.scrollHeight;
        window.openModal('ticketDetailModal');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
};

window.openSubmitTicketModal = function () { window.openModal('submitTicketModal'); };

// ── Ticket form submissions (wired after DOM ready in 13.app.boot.js) ──
window._handleNewTicket = async function (e) {
    e.preventDefault();
    Loading.show('Submitting...');
    try {
        await db.collection('tickets').add({
            userId:     window.currentUser.id,
            userEmail:  window.currentUser.email,
            subject:    document.getElementById('newTicketSubject').value,
            body:       document.getElementById('newTicketBody').value,
            status:     'Open',
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            timestamp:  firebase.firestore.FieldValue.serverTimestamp()
        });
        window.closeModal('submitTicketModal');
        renderMessages();
        showToast('Ticket submitted!', 'success');
    } catch (e) {
        showToast(e.message, 'error');
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
            senderId:  window.currentUser.id,
            message:   msg,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        document.getElementById('ticketReplyInput').value = '';
        window.openTicketDetail(tid);
    } catch (e) {
        showToast(e.message, 'error');
    }
};
