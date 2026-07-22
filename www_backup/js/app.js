
/* ==========================================================
   FILE: app.js
   DESCRIPTION: Main Logic, Firebase, Offline Caching
   ========================================================== */

/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */

const $ = s => document.querySelector(s);
let connectionInterval = null;
let timerInterval = null;
window.authCheckComplete = false;
const GEMINI_API_KEY = (window.ENV && window.ENV.GEMINI_API_KEY) || '';

/*  =====  ONE-PLAN GUARD  =====  */
function parseTimestamp(ts) {
    if (!ts) return 0;
    if (ts.seconds) return ts.seconds * 1000;
    if (ts.toDate) return ts.toDate().getTime();
    return new Date(ts).getTime();
}

function hasActivePlanNow() {
    if (!currentUser || !currentUser.subscriptions) return false;
    const now = Date.now();
    return currentUser.subscriptions.some(s => s.expiresAt && parseTimestamp(s.expiresAt) > now);
}

/*  =====  PLAN CALCULATORS  =====  */
function calcExpiresAt(unit, amount) {
    const now = new Date();
    const result = new Date(now);

    switch (unit) {
        case 'minutes': return new Date(now.getTime() + amount * 60 * 1000);
        case 'hours': return new Date(now.getTime() + amount * 60 * 60 * 1000);
        case 'days': return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
        case 'weeks': return new Date(now.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
        case 'months': {
            result.setMonth(result.getMonth() + amount);
            if (result.getDate() !== now.getDate()) {
                result.setDate(0);
            }
            return result;
        }
        default: return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
    }
}

/* ===== TIME FORMATTER (With Seconds) ===== */
function formatTimeLeft(ms) {
    if (ms <= 0) return 'Expired';

    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    let str = '';
    if (days > 0) str += `${days}d `;
    str += `${String(hours).padStart(2, '0')}h `;
    str += `${String(minutes).padStart(2, '0')}m `;
    str += `${String(seconds).padStart(2, '0')}s`;

    return str;
}

/*  =====  TIMER & PROGRESS BAR LOGIC  =====  */
function startPlanTimer() {
    stopPlanTimer();
    updateTimerUI(); // Run immediately
    timerInterval = setInterval(updateTimerUI, 1000);
}

function updateTimerUI() {
    const sub = getActiveSubscription();
    const statusEl = document.getElementById('dashUptime');
    const barEl = document.getElementById('planProgressBar');
    const startLabel = document.getElementById('planStartLabel');
    const endLabel = document.getElementById('planEndLabel');

    // 1. No Active Plan or Elements not ready
    if (!sub || !statusEl) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger-text)">Inactive</span>`;
        if (barEl) barEl.style.width = '0%';
        if (startLabel) startLabel.textContent = '--';
        if (endLabel) endLabel.textContent = '--';
        stopPlanTimer();
        return;
    }

    const now = Date.now();
    const end = parseTimestamp(sub.expiresAt);
    const start = sub.purchasedAt ? parseTimestamp(sub.purchasedAt) : (end - (24 * 60 * 60 * 1000));

    const totalDuration = end - start;
    const timeLeft = end - now;

    // 2. Expired Plan
    if (timeLeft <= 0) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger-text)">Expired</span>`;
        if (barEl) barEl.style.width = '0%';
        stopPlanTimer();

        // Trigger generic disconnect check safely
        if (window.NetworkTools && window.NetworkTools.guardHotspot) {
            window.NetworkTools.guardHotspot();
        }
        return;
    }

    // 3. Active Plan
    if (statusEl) {
        // Check if we have Wifi Info from NetworkTools
        const wifiName = window.NetworkTools && window.NetworkTools.lastKnownSSID
            ? `(${window.NetworkTools.lastKnownSSID})`
            : '';

        statusEl.innerHTML = `<span class="status-active-indicator" style="color:var(--color-success-text); font-weight:bold;">●</span> Online ${wifiName} &bull; ${formatTimeLeft(timeLeft)}`;
    }

    // Progress Bar
    const percentage = Math.max(0, Math.min(100, (timeLeft / totalDuration) * 100));
    if (barEl) {
        barEl.style.width = `${percentage}%`;

        // Color Logic
        if (percentage < 10) barEl.style.backgroundColor = 'var(--color-danger)';
        else if (percentage < 30) barEl.style.backgroundColor = '#ffaa00'; // Orange
        else barEl.style.backgroundColor = 'var(--color-success)';
    }

    // Date Labels
    if (startLabel) startLabel.textContent = new Date(start).toLocaleDateString();
    if (endLabel) endLabel.textContent = new Date(end).toLocaleDateString();
}

function stopPlanTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function getActiveSubscription() {
    if (!currentUser || !currentUser.subscriptions) return null;
    return currentUser.subscriptions.find(s => s.expiresAt && parseTimestamp(s.expiresAt) > Date.now());
}

/*  =====  FIREBASE CONFIG  =====  */
const _pid = (window.ENV && window.ENV.FIREBASE_PROJECT_ID) || "br3eze-africa-312df";
const firebaseConfig = {
    apiKey: (window.ENV && window.ENV.FIREBASE_API_KEY) || "AIzaSyANPQZKsAV9VsW9vKZJ3ghhrpnkxuLfdP8",
    authDomain: `${_pid}.firebaseapp.com`,
    databaseURL: `https://${_pid}-default-rtdb.firebaseio.com`,
    projectId: _pid,
    storageBucket: `${_pid}.firebasestorage.app`,
    messagingSenderId: "123902078923",
    appId: "1:123902078923:web:1153a45add9fe25208504e",
    measurementId: "G-Y6YS53B86S"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;
const storage = typeof firebase !== 'undefined' ? firebase.storage() : null;
window.currentUser = null;


// --- ENABLE OFFLINE PERSISTENCE ---
// Skip on file:// protocol (desktop browser / Cordova dev) where web storage is unavailable
const _isFileProtocol = window.location.protocol === 'file:';
if (db && !_isFileProtocol) {
    try {
        // Modern Firebase v9 settings to avoid deprecation warnings
        // Uses the new cache API if available in the compat layer
        if (typeof firebase.firestore.persistentLocalCache === 'function') {
            db.settings({
                cache: firebase.firestore.persistentLocalCache({
                    tabManager: firebase.firestore.persistentMultipleTabManager()
                })
            });
        } else {
            // Fallback for older v9 compat versions — suppresss deprecation warning with warning-level catch
            db.enablePersistence({ synchronizeTabs: true }).catch((e) => {
                if (e.code !== 'unimplemented' && e.code !== 'failed-precondition') {
                    console.warn('Firestore Persistence Setup Warning:', e.message);
                }
            });
        }
    } catch (e) {
        console.warn('Firestore Persistence Setup Warning:', e.message);
    }
}

/*  =====  AUTH ACTIONS  =====  */
// Auth is defined in js/auth.js — the canonical version with full voucher,
// Google redirect, and onAuthStateChanged logic.
// Do NOT redeclare Auth here to avoid overwriting the loaded module.

/*  =====  DATA STORE  =====  */
// DataStore is defined in js/datastore.js — the canonical version with full offline persistence, collection shortcuts, and support tickets logic.


function needsDisconnect() {
    if (!currentUser) return false;
    if (!navigator.onLine) return false;
    const activeSubs = (currentUser.subscriptions || []).filter(s => s.expiresAt && parseTimestamp(s.expiresAt) > Date.now());
    return (currentUser.credits <= 0 && activeSubs.length === 0);
}

function toggleAuthForm() {
    document.getElementById('loginForm').classList.toggle('hidden');
    document.getElementById('signupForm').classList.toggle('hidden');
}

/*  =====  APP INIT  =====  */
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    if (auth) Loading.show('Starting up...');

    // Auth event registration logic (Google redirect & state observer) is canonically handled in js/auth.js to avoid double-firing and conflict.

    // NOTE: loginFormElement and signupFormElement submit handlers are registered
    // in auth.js DOMContentLoaded to avoid double-firing. Only app-level forms here.

    document.getElementById('newTicketForm')?.addEventListener('submit', submitNewTicket);
    document.getElementById('adminUserForm')?.addEventListener('submit', saveAdminUser);
    document.getElementById('adminPlanForm')?.addEventListener('submit', saveAdminPlan);
    document.getElementById('adminNetworkForm')?.addEventListener('submit', saveNetworkSettings);
    document.getElementById('redeemVoucherForm')?.addEventListener('submit', redeemVoucher);
    document.getElementById('generateVoucherForm')?.addEventListener('submit', generateVouchers);
    document.getElementById('updateProfileForm')?.addEventListener('submit', handleUpdateProfile);
    document.getElementById('shareCreditForm')?.addEventListener('submit', e => {
        e.preventDefault();
        showToast('Credit sharing is not yet implemented.', 'info');
    });
    document.getElementById('sendVoucherForm')?.addEventListener('submit', sendVoucherToUser);

    // Chat UI Logic
    const chatInput = document.getElementById('chatInput');
    const actionBtn = document.getElementById('chatActionBtn');
    const chatForm = document.getElementById('chatForm');

    if (chatInput && actionBtn) {
        const icon = actionBtn.querySelector('i');

        // 1. Monitor Input for changes
        const updateButtonState = () => {
            const hasText = chatInput.value.trim().length > 0;

            if (hasText) {
                // Switch to Send Arrow
                if (actionBtn.classList.contains('mode-mic')) {
                    actionBtn.classList.remove('mode-mic');
                    actionBtn.classList.add('mode-send');
                    icon.className = 'fas fa-arrow-up';
                    actionBtn.setAttribute('type', 'submit');
                }
            } else {
                // Switch to Microphone
                if (actionBtn.classList.contains('mode-send')) {
                    actionBtn.classList.remove('mode-send');
                    actionBtn.classList.add('mode-mic');
                    icon.className = 'fas fa-microphone';
                    actionBtn.setAttribute('type', 'button');
                }
            }
        };

        chatInput.addEventListener('input', updateButtonState);
        chatInput.addEventListener('keyup', updateButtonState);

        // 2. Handle Button Click
        actionBtn.addEventListener('click', (e) => {
            if (actionBtn.classList.contains('mode-mic')) {
                e.preventDefault();
                // --- PLACEHOLDER FOR VOICE LOGIC ---
                if (typeof showToast === 'function') showToast("Hold to record (Feature coming soon)", "info");
            }
        });

        // 3. Handle Form Submit (Enter key or Send Click)
        if (chatForm) {
            chatForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (chatInput.value.trim().length > 0) {
                    sendChatMessage();
                    // Reset button to mic after sending
                    // chatInput.value is cleared inside sendChatMessage
                    setTimeout(updateButtonState, 100);
                }
            });
        }
    }
});

/*  =====  UI HELPERS  =====  */
function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('mainHeader').classList.add('hidden');
}

async function showMainApp(user) {
    // Accept user directly (from auth.js) or fall back to global
    if (user && user.uid) window.currentUser = user;

    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    document.getElementById('mainHeader').classList.remove('hidden');

    if (currentUser.role === 'admin') {
        document.getElementById('adminToolsContainer').classList.remove('hidden');
    } else {
        document.getElementById('adminToolsContainer').classList.add('hidden');
    }
    configureSidebarForUser();
    await updateUI();
    showSection('home');

    if (currentUser.pendingNotification) {
        const n = currentUser.pendingNotification;
        if (n.type === 'voucher') showVoucherNotification(n.title, n.message, n.code);
        // Clear the notification — guard against db being undefined (e.g. called before Firestore ready)
        if (navigator.onLine) {
            try {
                const firestoreDb = (typeof db !== 'undefined' && db) || (getFirestore?.());
                if (firestoreDb) {
                    await firestoreDb.collection('users').doc(currentUser.id).update({
                        pendingNotification: firebase.firestore.FieldValue.delete()
                    });
                }
            } catch (e) { console.warn('[App] Could not clear pendingNotification:', e.message); }
        }
    }

    // The NetworkTools initialization is handled by index.js in the onDeviceReady sequence.
    // It waits for DataStore and currentUser to be ready via waitForDataStore(), 
    // avoiding the race condition where Cordova plugins aren't loaded yet.
    if (needsDisconnect()) {
        try {
            const cfg = await DataStore.getNetworkSettings();
            showToast(`Access expired: Disconnecting...`, 'info');
            if (window.NetworkTools) {
                await window.NetworkTools.disconnect(cfg.ssid);
            }
        } catch (e) {
            console.warn("Failed to process expiration disconnect:", e);
        }
    }

    Loading.hide();
}

function configureSidebarForUser() {
    const plansLink = document.getElementById('sidebarPlansLink');
    if (!plansLink) return;

    if (currentUser.role === 'admin') {
        plansLink.innerHTML = `<i class="fas fa-chart-line"></i> <span class="nav-text">Statistics</span>`;
        plansLink.setAttribute('onclick', "showSection('admin-stats')");
        plansLink.setAttribute('data-section', 'admin-stats');
    } else {
        plansLink.innerHTML = `<i class="fas fa-box"></i> <span class="nav-text">Plans</span>`;
        plansLink.setAttribute('onclick', "showSection('subscriptions')");
        plansLink.setAttribute('data-section', 'subscriptions');
    }
}

function toggleDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const isVisible = dropdown.style.display === 'block';
    document.querySelectorAll('.user-dropdown, .header-dropdown-nav').forEach(d => d.style.display = 'none');
    dropdown.style.display = isVisible ? 'none' : 'block';
}

function showSection(sectionId) {
    document.querySelectorAll('.dashboard-section').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));

    const targetSection = document.getElementById(`${sectionId}-section`);
    const targetLi = document.querySelector(`.sidebar li[data-section="${sectionId}"]`);

    if (targetSection) targetSection.classList.remove('hidden');
    if (targetLi) targetLi.classList.add('active');

    switch (sectionId) {
        case 'messages': renderMessagesSection(); break;
        case 'orders': updateTransactionHistory(); break;
        case 'subscriptions': updatePlans(); break;
        case 'settings': populateUserSettings(); break;
        case 'admin-stats': renderAdminStats(); break;
    }
    document.getElementById('userDropdown').style.display = 'none';
}

/*  =====  RENDERERS  =====  */
async function updateUI() {
    if (!currentUser) return;
    // Reload user to get latest credits/subs
    currentUser = await DataStore.getUser(currentUser.id);

    updateNavbar();
    updateDashboard();

    if (window.NetworkTools && window.NetworkTools.isPluginAvailable()) {
        window.NetworkTools.displayConnectionInfo();
    }
    if (currentUser.role === 'admin') {
        // Load admin stuff async so it doesn't block UI
        Promise.all([
            renderUserManagement(),
            renderPlanManagementAdmin(),
            renderVoucherList(),
            renderNetworkSettings()
        ]).catch(err => console.error("Admin load error", err));
    }
}

function updateNavbar() {
    document.getElementById('navUsername').textContent = currentUser.fullname || currentUser.username;
    const nameToUse = currentUser.fullname || currentUser.username || 'User';
    const nameParts = nameToUse.trim().split(/\s+/);
    let initials = nameParts[0].charAt(0).toUpperCase();
    if (nameParts.length > 1) {
        initials += nameParts[1].charAt(0).toUpperCase();
    }
    document.getElementById('navUsernameShort').textContent = initials;
    document.getElementById('dropdownFullname').textContent = nameToUse;
    document.getElementById('dropdownEmail').textContent = currentUser.email + (currentUser.role === 'admin' ? ' (Admin)' : '');
}

function updateDashboard() {
    document.getElementById('dashCredits').textContent = (currentUser.credits || 0).toFixed(2);
    const activeSubscriptions = (currentUser.subscriptions || []).filter(s => s.expiresAt && parseTimestamp(s.expiresAt) > Date.now());
    document.getElementById('dashPlans').textContent = activeSubscriptions.length;
    document.getElementById('dashDevices').textContent = activeSubscriptions.length > 0 ? 1 : 0;

    const activeSub = getActiveSubscription();
    if (activeSub) startPlanTimer();
    else updateTimerUI(); // Reset to Inactive state
}

/*  =====  PLANS  =====  */
async function updatePlans() {
    const plans = await DataStore.getPlans();
    const container = document.getElementById('plansList');

    if (!plans.length) {
        container.innerHTML = `<p class="text-medium">No plans are available at the moment. Please check back later.</p>`;
        return;
    }
    const active = hasActivePlanNow();

    container.innerHTML = plans.map(plan => {
        const imageBlock = plan.imageUrl
            ? `<img src="${plan.imageUrl}" alt="${plan.name}" class="plan-image">`
            : `<div class="plan-image-placeholder"><i class="fas fa-wifi"></i></div>`;

        // Disable button only if a plan is active. Admin can always see enabled buttons for testing if needed
        const btn = active
            ? `<button class="btn btn-primary btn-block" disabled>Active plan still running</button>`
            : `<button class="btn btn-primary btn-block" onclick="purchasePlan('${plan.id}')">Purchase ($${plan.price.toFixed(2)})</button>`;
        return `
              <div class="card plan-card">
                <div class="plan-content-wrapper">
                    <div class="plan-image-container">${imageBlock}</div>
                    <h3>${plan.name}</h3>
                    <p class="text-medium">${plan.description}</p>
                    <div class="price">$${plan.price.toFixed(2)}</div>
                    <ul>
                        <li><i class="fas fa-check"></i> ${plan.deviceLimit} device${plan.deviceLimit > 1 ? 's' : ''}</li>
                        <li><i class="fas fa-check"></i> ${plan.durationValue || plan.durationDays} ${plan.durationUnit || 'day'}${plan.durationValue > 1 ? 's' : ''} access</li>
                    </ul>
                </div>
                <div class="plan-button-wrapper">
                    ${btn}
                </div>
            </div>`;
    }).join('');
}

async function purchasePlan(planId) {
    if (!navigator.onLine) return showToast("Must be online to purchase.", "error");

    if (hasActivePlanNow()) {
        showToast('You already have an active plan. Wait until it expires.', 'error');
        return;
    }
    const plans = await DataStore.getPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) return showToast('Plan not found.', 'error');
    if (currentUser.credits < plan.price) return showToast('Insufficient credits.', 'error');
    if (!confirm(`Buy “${plan.name}” for $${plan.price.toFixed(2)}?`)) return;

    Loading.show('Processing purchase...');
    try {
        const now = new Date();
        const expires = calcExpiresAt(plan.durationUnit || 'days', plan.durationValue || plan.durationDays);
        const newSubscription = {
            planId: plan.id,
            planName: plan.name,
            purchasedAt: firebase.firestore.Timestamp.fromDate(now),
            expiresAt: firebase.firestore.Timestamp.fromDate(expires)
        };
        const batch = db.batch();
        const userRef = db.collection('users').doc(currentUser.id);
        batch.update(userRef, {
            credits: firebase.firestore.FieldValue.increment(-plan.price),
            subscriptions: firebase.firestore.FieldValue.arrayUnion(newSubscription)
        });
        const txRef = db.collection('transactions').doc();
        batch.set(txRef, {
            userId: currentUser.id,
            type: 'purchase',
            description: `Plan Purchase: ${plan.name}`,
            amount: -plan.price,
            planId: plan.id,
            planName: plan.name,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
        showToast('Plan purchased successfully!', 'success');
        await refreshCurrentUser();
        updateUI();
        startPlanTimer();

        // Auto connect if configured
        if (window.NetworkTools && window.NetworkTools.initialize) {
            window.NetworkTools.initialize();
        }
        await window.dispatchGlobalIntent('purchase_plan', {
            planId: planId,
            userId: currentUser ? currentUser.id : null
        });
        // The WebSocket or EventBus listener will handle the success/fail response
        Loading.hide();
    } catch (e) {
        showToast(`Request Error: ${e.message}`, 'error');
        Loading.hide();
    }
}

async function refreshCurrentUser() {
    if (auth.currentUser) {
        currentUser = await DataStore.getUser(auth.currentUser.uid);
    }
}

/*  =====  VOUCHERS  =====  */
function openRedeemVoucher() {
    document.getElementById('redeemVoucherForm').reset();
    openModal('redeemVoucherModal');
}

let html5QrCode = null;

window.stopQRScanner = async function() {
    const readerDiv = document.getElementById('qr-reader');
    if (html5QrCode) {
        try {
            const state = html5QrCode.getState();
            if (state === 2 || state === 3) { // SCANNING or PAUSED
                await html5QrCode.stop();
            }
        } catch (e) { console.warn('QR Stop Error:', e); }
        try { html5QrCode.clear(); } catch (e) {}
    }
    if (readerDiv) readerDiv.style.display = 'none';
};

async function scanQRCode() {
    const readerDiv = document.getElementById('qr-reader');
    const input = document.getElementById('voucherCodeInput');

    if (readerDiv.style.display === 'block') {
        // Stop scanning if already active
        await stopQRScanner();
        return;
    }

    readerDiv.style.display = 'block';

    if (!html5QrCode) {
        html5QrCode = new Html5Qrcode("qr-reader");
    }

    const onScanSuccess = (decodedText) => {
        const raw = decodedText.trim().toUpperCase();
        input.value = raw;
        showToast(`✅ Scanned: ${raw}`, 'success');

        // Stop scanning upon success
        stopQRScanner();
    };

    const onScanFailure = (error) => {
        // Continuous scan failure (normal, ignore)
    };

    try {
        await html5QrCode.start(
            { facingMode: "environment" },
            {
                fps: 10,
                qrbox: { width: 250, height: 250 }
            },
            onScanSuccess,
            onScanFailure
        );
    } catch (err) {
        console.warn('QR Scanner Error:', err);
        showToast('Camera error or blocked. Please enter code manually.', 'error');
        readerDiv.style.display = 'none';
    }
}

async function redeemVoucher(event) {
    event.preventDefault();
    if (!navigator.onLine) return showToast("Must be online to redeem.", "error");
    const code = document.getElementById('voucherCodeInput').value.trim();
    if (!code) return;
    Loading.show('Redeeming...')

    try {
        const voucher = await DataStore.getVoucher(code);
        if (!voucher || voucher.used) return showToast('Invalid or already used voucher code.', 'error');

        const batch = db.batch();
        const userRef = db.collection('users').doc(currentUser.id);
        batch.update(userRef, { credits: firebase.firestore.FieldValue.increment(voucher.value) });

        const txRef = db.collection('transactions').doc();
        batch.set(txRef, {
            userId: currentUser.id,
            type: 'redeem',
            description: `Voucher Redeemed: ${voucher.code}`,
            amount: voucher.value,
            voucherCode: voucher.code,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        const voucherRef = db.collection('vouchers').doc(voucher.id);
        batch.update(voucherRef, {
            used: true,
            usedBy: currentUser.id,
            redeemedByUsername: currentUser.fullname,
            usedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();
        Loading.hide();
        closeModal('redeemVoucherModal');
        showToast(`Redeemed $${voucher.value.toFixed(2)}!`, 'success');
        updateUI();
    } catch (e) {
        Loading.hide();
        showToast(e.message, 'error');
    }
}

function openShareCredit() {
    document.getElementById('shareCreditForm').reset();
    openModal('shareCreditModal');
}

/*  =====  SETTINGS & PROFILE  =====  */
function populateUserSettings() {
    if (!currentUser) return;
    document.getElementById('settingsFullname').value = currentUser.fullname || '';
    document.getElementById('settingsUsername').value = currentUser.username || '';
    document.getElementById('settingsPhoneNumber').value = currentUser.phoneNumber || '';
    document.getElementById('settingsAddress').value = currentUser.address || '';
    document.getElementById('settingsEmail').value = currentUser.email || '';
}

async function handleUpdateProfile(e) {
    e.preventDefault();
    Loading.show('Updating profile...');

    // Safely get values, defaulting to empty string if element missing
    const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value.trim() : '';

    const updates = {
        fullname: getVal('settingsFullname'),
        username: getVal('settingsUsername'),
        phoneNumber: getVal('settingsPhoneNumber'),
        address: getVal('settingsAddress'),
    };
    try {
        await db.collection('users').doc(currentUser.id).update(updates);
        currentUser = { ...currentUser, ...updates };
        Loading.hide();
        showToast('Profile updated!', 'success');
        updateUI();
    } catch (err) {
        Loading.hide();
        showToast('Update failed: ' + err.message, 'error');
    }
}

/*  =====  TICKETS  =====  */
async function openTicketDetail(ticketId) {
    Loading.show('Loading conversation...');
    try {
        const tickets = await DataStore.getTickets();
        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket) throw new Error("Ticket not found");

        const replies = await DataStore.getTicketReplies(ticketId);

        document.getElementById('ticketModalTitle').textContent = ticket.subject;
        document.getElementById('ticketModalSubtitle').textContent = `ID: ${ticket.id} • Created: ${ticket.createdAt?.toDate().toLocaleDateString()}`;
        document.getElementById('currentTicketId').value = ticketId;

        document.getElementById('ticketModalStatus').innerHTML = `<span class="ticket-status-badge status-${ticket.status.toLowerCase()}">${ticket.status}</span>`;

        const actionsContainer = document.getElementById('ticketModalActions');
        actionsContainer.innerHTML = '';
        if (currentUser.role === 'admin' && ticket.status !== 'Closed') {
            actionsContainer.innerHTML = `<button class="btn btn-sm btn-danger" onclick="closeTicket('${ticket.id}')">Close Ticket</button>`;
        }

        const container = document.getElementById('ticketRepliesContainer');
        container.innerHTML = '';

        const originalDate = ticket.createdAt?.toDate().toLocaleString() || 'Unknown date';
        container.innerHTML += `
            <div class="ticket-message original-message">
                <div class="meta"><strong>${ticket.userEmail}</strong> (Original Issue) - <small>${originalDate}</small></div>
                <div class="body">${ticket.body}</div>
            </div>
        `;

        replies.forEach(reply => {
            const isMe = reply.senderId === currentUser.id;
            const isAdmin = reply.role === 'admin' || reply.role === 'system';
            const alignClass = isMe ? 'reply-me' : 'reply-other';
            const roleBadge = isAdmin ? '<span class="badge-admin">SUPPORT</span>' : '';
            const dateStr = reply.timestamp ? reply.timestamp.toDate().toLocaleString() : 'Just now';

            container.innerHTML += `
                <div class="ticket-message ${alignClass} ${isAdmin ? 'is-admin' : ''}">
                    <div class="meta">${roleBadge} <strong>${reply.senderName}</strong> <small>${dateStr}</small></div>
                    <div class="body">${reply.message}</div>
                </div>
            `;
        });

        setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);

        openModal('ticketDetailModal');
    } catch (e) {
        console.error(e);
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
}

document.getElementById('ticketReplyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticketId = document.getElementById('currentTicketId').value;
    const message = document.getElementById('ticketReplyInput').value.trim();
    if (!message) return;

    const btn = e.target.querySelector('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        await DataStore.sendTicketReply(ticketId, {
            senderId: currentUser.id,
            senderName: currentUser.fullname || currentUser.username,
            role: currentUser.role,
            message: message
        });
        document.getElementById('ticketReplyInput').value = '';
        showToast('Reply sent', 'success');
        await openTicketDetail(ticketId);
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

async function closeTicket(ticketId) {
    if (!confirm(`Mark ticket as CLOSED? Users cannot reply to closed tickets.`)) return;
    try {
        await DataStore.updateTicketStatus(ticketId, 'Closed');
        await DataStore.sendTicketReply(ticketId, {
            senderId: 'SYSTEM',
            senderName: 'System',
            role: 'system',
            message: 'This conversation has been marked as Closed.'
        });
        showToast('Ticket Closed.', 'success');
        // Refresh the thread list and reload conversation to show closed state
        await renderMessagesSection();
        await loadConversationPanel(ticketId);
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function openSubmitTicketModal() {
    document.getElementById('newTicketForm').reset();
    openModal('submitTicketModal');
}

async function submitNewTicket(event) {
    event.preventDefault();
    const newTicket = {
        userId: currentUser.id,
        userEmail: currentUser.email,
        subject: document.getElementById('newTicketSubject').value,
        body: document.getElementById('newTicketBody').value,
        status: 'Open',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        const ref = await db.collection('tickets').add(newTicket);
        closeModal('submitTicketModal');
        showToast('Conversation started!', 'success');
        await renderMessagesSection();
        // Auto-load the new thread in the panel
        await loadConversationPanel(ref.id);
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

/*  =====  ADMIN STATS & CHARTS  =====  */
let adminChartDataCache = {};

async function renderAdminStats() {
    Loading.show('Analyzing...');
    const range = parseInt(document.getElementById('statsTimeFilter')?.value) || 30;

    const users = await DataStore.getAllUsers();
    const transactions = await DataStore.getAllTransactions();
    const tickets = await DataStore.getTickets();
    const plans = await DataStore.getPlans();

    // --- DATE LOGIC ---
    const now = new Date();
    const startDate = new Date();
    startDate.setDate(now.getDate() - range);

    // Previous Period
    const prevStartDate = new Date();
    prevStartDate.setDate(startDate.getDate() - range);

    // --- DATA FILTERING ---
    const currentTx = transactions.filter(t => t.timestamp && t.timestamp.toDate() >= startDate);
    const prevTx = transactions.filter(t => {
        const d = t.timestamp ? t.timestamp.toDate() : new Date(0);
        return d >= prevStartDate && d < startDate;
    });

    // --- KPI CALCULATIONS ---
    const revenue = currentTx
        .filter(t => t.type === 'purchase')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const prevRevenue = prevTx
        .filter(t => t.type === 'purchase')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Calculate Growth %
    let growthPct = 0;
    if (prevRevenue > 0) growthPct = ((revenue - prevRevenue) / prevRevenue) * 100;
    else if (revenue > 0) growthPct = 100;

    const growthHtml = growthPct >= 0
        ? `<small style="color:var(--color-success-text); font-size:0.7rem;">(+${growthPct.toFixed(1)}%)</small>`
        : `<small style="color:var(--color-danger-text); font-size:0.7rem;">(${growthPct.toFixed(1)}%)</small>`;

    const activePlansCount = users.reduce((cnt, u) => {
        const subs = u.subscriptions || [];
        const activeUserSubs = subs.filter(s => s.expiresAt && parseTimestamp(s.expiresAt) > Date.now()).length;
        return cnt + activeUserSubs;
    }, 0);

    const arpu = users.length > 0 ? (revenue / users.length) : 0;

    document.getElementById('statsTotalRevenue').innerHTML = `${revenue.toFixed(2)} ${growthHtml}`;
    document.getElementById('statsTotalUsers').textContent = users.length;
    document.getElementById('statsActivePlans').textContent = activePlansCount;
    document.getElementById('statsOpenTickets').textContent = tickets.filter(t => t.status === 'Open').length;

    /* --- CHART 1: REVENUE TREND --- */
    const revChartContainer = document.getElementById('revenueChart');
    let buckets = [];
    const isLongRange = range > 31;
    const bucketCount = isLongRange ? 12 : (range > 7 ? 15 : 7);

    for (let i = 0; i < bucketCount; i++) {
        const d = new Date();
        if (isLongRange) d.setMonth(d.getMonth() - i);
        else d.setDate(d.getDate() - i);

        const key = isLongRange
            ? `${d.getFullYear()}-${d.getMonth()}`
            : d.toISOString().split('T')[0];

        const label = isLongRange
            ? d.toLocaleDateString('en-US', { month: 'short' })
            : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

        buckets.push({ key, label, amount: 0 });
    }
    buckets.reverse();

    currentTx.forEach(tx => {
        if (tx.type === 'purchase' && tx.timestamp) {
            const d = tx.timestamp.toDate();
            const key = isLongRange
                ? `${d.getFullYear()}-${d.getMonth()}`
                : d.toISOString().split('T')[0];
            const bucket = buckets.find(b => b.key === key);
            if (bucket) bucket.amount += Math.abs(tx.amount);
        }
    });

    const maxRev = Math.max(...buckets.map(d => d.amount), 1);
    const avgRev = revenue / bucketCount;

    revChartContainer.innerHTML = buckets.map(day => {
        const height = (day.amount / maxRev) * 100;
        let barClass = 'chart-bar';
        if (day.amount === maxRev && maxRev > 0) barClass += ' is-peak';
        else if (day.amount < (avgRev * 0.5)) barClass += ' is-low';

        return `
        <div class="chart-bar-wrapper" style="cursor:help;">
            <div class="${barClass}" 
                 style="height: ${height}%;" 
                 data-tooltip="${day.label}: $${day.amount.toFixed(2)}">
                ${day.amount > 0 && height > 15 ? `<span class="value">$${day.amount.toFixed(0)}</span>` : ''}
            </div>
            <div class="chart-label">${day.label}</div>
        </div>`;
    }).join('');

    /* --- CHART 2: PLAN CONVERSION --- */
    const popChartContainer = document.getElementById('popularityChart');

    const planStats = plans.map(plan => {
        const salesInPeriod = currentTx.filter(t => t.type === 'purchase' && t.planId === plan.id).length;
        const activeNow = users.filter(u =>
            u.subscriptions?.some(s => s.planId === plan.id && s.expiresAt?.seconds && s.expiresAt.seconds * 1000 > Date.now())
        ).length;
        let expired = Math.max(0, salesInPeriod - activeNow);

        return {
            name: plan.name,
            sales: salesInPeriod,
            active: activeNow,
            expired: expired,
            conversion: salesInPeriod > 0 ? Math.round((activeNow / (salesInPeriod || 1)) * 100) : 0
        };
    }).sort((a, b) => b.sales - a.sales);

    if (planStats.every(p => p.sales === 0 && p.active === 0)) {
        popChartContainer.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><p class="text-medium">No plan activity in this period.</p></div>';
    } else {
        popChartContainer.innerHTML = planStats.map(stat => {
            const totalBar = stat.active + stat.expired;
            const activePct = totalBar > 0 ? (stat.active / totalBar) * 100 : 0;
            const expPct = totalBar > 0 ? (stat.expired / totalBar) * 100 : 0;

            let retentionClass = 'text-medium';
            if (stat.conversion >= 50) retentionClass = 'text-success';
            else if (stat.conversion >= 25) retentionClass = 'text-warning';
            else if (stat.conversion > 0) retentionClass = 'text-danger';

            return `
    <div class="plan-stat-row">
        <div class="plan-stat-header">
            <strong>${stat.name}</strong>
            <span>Rate: <span style="color:var(--color-info-text)">${stat.conversion}%</span> retention</span>
        </div>
        <div class="multi-progress-track">
            <div class="prog-bar-segment prog-active" style="width: ${activePct}%">
                ${activePct > 15 ? stat.active : ''}
            </div>
            <div class="prog-bar-segment prog-expired" style="width: ${expPct}%">
                ${expPct > 15 ? stat.expired : ''}
            </div>
        </div>
        <div style="font-size: 0.75rem; color: var(--color-text-medium); margin-top: 4px; display:flex; justify-content:space-between;">
            <span>Active: ${stat.active} / Expired: ${stat.expired}</span>
            <span>Total Sales: ${stat.sales}</span>
        </div>
    </div>`;
        }).join('');
    }

    adminChartDataCache = {
        period: range + ' days',
        revenue: revenue,
        prevRevenue: prevRevenue,
        growth: growthPct.toFixed(1) + '%',
        arpu: arpu.toFixed(2),
        revenueTrend: buckets.map(b => b.amount),
        peakDay: buckets.reduce((a, b) => a.amount > b.amount ? a : b).label,
        planStats: planStats,
        totalUsers: users.length,
        activeUsers: activePlansCount
    };

    Loading.hide();
}

/* --- ACTIVE CONNECTIONS MODAL --- */
async function openActiveConnectionsModal() {
    const container = document.getElementById('activeConnectionsContainer');
    container.innerHTML = '<p class="text-medium">Scanning active sessions...</p>';
    openModal('activeConnectionsModal');

    try {
        const allUsers = await DataStore.getAllUsers();

        const activeUsers = allUsers.filter(u =>
            u.subscriptions?.some(s => s.expiresAt && parseTimestamp(s.expiresAt) > Date.now())
        );

        if (activeUsers.length === 0) {
            container.innerHTML = '<p class="text-medium">No active connections found.</p>';
            return;
        }

        const renderTable = () => {
            // Check if modal is still open, otherwise kill interval
            if (!document.getElementById('activeConnectionsModal').classList.contains('active')) {
                clearInterval(connectionInterval);
                return;
            }

            const now = Date.now();
            let html = `<table class="admin-table" id="connectionsTable">
                <thead>
                    <tr>
                        <th>User / Device</th>
                        <th>IP Address</th>
                        <th>Time Remaining</th>
                    </tr>
                </thead>
                <tbody>`;

            activeUsers.forEach(u => {
                const sub = u.subscriptions.find(s => s.expiresAt && parseTimestamp(s.expiresAt) > now);
                if (!sub) return;

                const end = parseTimestamp(sub.expiresAt);
                const timeLeft = end - now;
                const timeString = formatTimeLeft(timeLeft);
                const timeColor = timeLeft < 3600000 ? 'var(--color-danger-text)' : 'var(--color-success-text)';

                const deviceName = u.deviceModel || '<span class="text-medium" style="font-size:0.8em">Unknown Device</span>';
                const ipAddress = u.lastIP || '<span class="text-medium" style="font-size:0.8em">--</span>';

                let icon = '<i class="fas fa-mobile-alt"></i>';
                if (u.platform === 'iOS') icon = '<i class="fab fa-apple"></i>';
                else if (u.platform === 'Android') icon = '<i class="fab fa-android"></i>';
                else if (!u.platform || u.platform === 'Web') icon = '<i class="fas fa-globe"></i>';

                html += `<tr>
                    <td>
                        <strong>${u.fullname}</strong><br>
                        <small class="text-medium">${icon} ${deviceName}</small>
                    </td>
                    <td>
                        <span style="font-family:monospace; color:var(--color-info-text);">${ipAddress}</span>
                    </td>
                    <td style="font-weight:bold; color:${timeColor}">
                        ${timeString}
                    </td>
                </tr>`;
            });

            html += `</tbody></table>`;

            if (container) container.innerHTML = html;
        };

        renderTable();

        if (connectionInterval) clearInterval(connectionInterval);
        connectionInterval = setInterval(renderTable, 1000);

    } catch (e) {
        container.innerHTML = `<p class="text-danger">Error loading connections: ${e.message}</p>`;
    }
}

function filterConnectionsTable() {
    const input = document.getElementById('connectionSearch');
    const filter = input.value.toUpperCase();
    const table = document.getElementById('connectionsTable');
    if (!table) return;
    const tr = table.getElementsByTagName('tr');

    for (let i = 1; i < tr.length; i++) {
        const tdUser = tr[i].getElementsByTagName('td')[0];
        const tdIP = tr[i].getElementsByTagName('td')[1];
        const tdPlatform = tr[i].getElementsByTagName('td')[2];

        if (tdUser || tdIP || tdPlatform) {
            const txtValue = (tdUser.textContent || '') + (tdIP.textContent || '') + (tdPlatform.textContent || '');
            if (txtValue.toUpperCase().indexOf(filter) > -1) {
                tr[i].style.display = "";
            } else {
                tr[i].style.display = "none";
            }
        }
    }
}

/* --- ADMIN AI INTELLIGENCE --- */
async function openAdminAI() {
    window.openChatBotModal();
    const log = document.getElementById('chatLog');

    // Safety check: ensure stats are loaded
    if (!adminChartDataCache || !adminChartDataCache.revenueTrend) {
        // If data isn't ready, try to load it first
        try {
            await renderAdminStats();
        } catch (e) {
            window.sendChatMessage(); // Fallback to standard chat
            return;
        }
    }

    const d = adminChartDataCache;
    if (!d || !d.revenueTrend) {
        window.sendChatMessage();
        return;
    }

    const analysisPrompt = `
    ACT AS A BUSINESS INTELLIGENCE ANALYST for 'Power Connect' ISP.
    
    Here is the data for the last ${d.period}:
    1. FINANCIALS:
       - Total Revenue: $${d.revenue.toFixed(2)} (Growth: ${d.growth} vs previous period)
       - ARPU: $${d.arpu}
       - Peak Sales Day: ${d.peakDay}
    
    2. NETWORK HEALTH:
       - Total Registered Users: ${d.totalUsers}
       - Active Users: ${d.activeUsers}
    
    3. PRODUCT PERFORMANCE:
       ${d.planStats.map(p => `- ${p.name}: Sold ${p.sales}, Active ${p.active}, Retention ${p.conversion}%`).join('\n')}

    TASK:
    Provide a bullet-point report.
    - **Trend Analysis**: Is the growth positive?
    - **Product Insight**: Which plan has the best retention?
    - **Actionable Advice**: One specific marketing move.
    `;

    const loadingId = 'admin-loading-' + Date.now();
    const div = document.createElement('div');
    div.className = 'chat-message bot';
    div.innerHTML = `<div class="bot-avatar"><i class="fas fa-brain"></i></div><div class="bubble bot" id="${loadingId}">Analyzing growth rates and user retention...</div>`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
                generationConfig: { temperature: 0.5 }
            })
        });
        const data = await response.json();
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Analysis failed.";

        const bubble = document.getElementById(loadingId);
        const formattedReply = reply
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br/>');

        if (bubble) bubble.innerHTML = `<strong>📈 Intelligence Report:</strong><br/><br/>${formattedReply}`;

    } catch (e) {
        const bubble = document.getElementById(loadingId);
        if (bubble) bubble.innerHTML = "⚠️ AI Connection Error.";
    }
}

/* Admin logic moved to AppAdmin */










/*  =====  MISC  =====  */


function showVoucherNotification(title, message, codeToCopy) {
    const toast = document.getElementById('toast');
    const iconEl = document.getElementById('toastIcon');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !iconEl || !msgEl) return;
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Code';
    copyButton.className = 'btn btn-sm';
    copyButton.style.marginLeft = '15px';
    copyButton.style.color = 'var(--color-background)';
    copyButton.style.backgroundColor = 'var(--color-text-light)';
    copyButton.onclick = () => {
        navigator.clipboard.writeText(codeToCopy).then(() => showToast('Code copied!', 'success')).catch(() => showToast('Failed to copy.', 'error'));
    };
    toast.style.backgroundColor = 'var(--color-info)';
    toast.style.color = 'var(--color-text-light)';
    iconEl.textContent = '🎁';
    msgEl.textContent = message;
    msgEl.innerHTML = '';
    msgEl.appendChild(document.createTextNode(message));
    msgEl.appendChild(copyButton);
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
        msgEl.innerHTML = '';
    }, 10000);
}

async function updateTransactionHistory() {
    const container = document.getElementById('transactionHistoryContainer');
    container.innerHTML = `<p class="text-medium" style="padding: 25px;">Loading...</p>`;
    try {
        const allTransactions = await DataStore.getTransactionsForUser(currentUser.id);
        if (!allTransactions.length) {
            container.innerHTML = `<p class="text-medium" style="padding: 25px;">No transactions found.</p>`;
            return;
        }
        const { data, totalPages } = Pagination.getPageData(allTransactions, 'transactions');
        let html = `<table class="admin-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>`;
        data.forEach(tx => {
            const amountColor = tx.amount < 0 ? 'var(--color-danger-text)' : 'var(--color-success-text)';
            const sign = tx.amount > 0 ? '+' : '';
            const dateStr = tx.timestamp ? tx.timestamp.toDate().toLocaleString() : 'N/A';
            html += `
                <tr>
                    <td class="text-medium">${dateStr}</td>
                    <td>${tx.description}</td>
                    <td style="color: ${amountColor}; font-weight: 600;">${sign}$${Math.abs(tx.amount).toFixed(2)}</td>
                </tr>`;
        });
        html += `</tbody></table>`;
        html += Pagination.renderControls('transactions', totalPages, 'updateTransactionHistory');
        container.innerHTML = html;
    } catch (err) {
        container.innerHTML = `<p class="text-medium">Error loading history.</p>`;
    }
}

async function renderMessagesSection() {
    const container = document.getElementById('ticketListContainer');
    if (!container) return;
    container.innerHTML = `<div class="p2p-thread-loading"><i class="fas fa-circle-notch fa-spin"></i><span>Loading conversations...</span></div>`;

    const tickets = await DataStore.getTickets();
    if (!tickets.length) {
        container.innerHTML = `<div class="p2p-thread-loading"><i class="fas fa-inbox"></i><span>No conversations yet.</span></div>`;
        return;
    }

    container.innerHTML = tickets.map(ticket => {
        const statusColors = { 'Open': 'var(--color-info)', 'Closed': 'var(--color-text-muted)', 'Archived': 'var(--color-text-muted)', 'Resolved': 'var(--color-success)' };
        const statusColor = statusColors[ticket.status] || 'var(--color-info)';
        const initials = (ticket.isSystemMessage ? 'SYS' : (ticket.userEmail || 'U').substring(0, 2).toUpperCase());
        const avatarBg = ticket.isSystemMessage ? 'var(--color-info)' : 'var(--gradient-primary)';
        const dateStr = ticket.lastUpdate ? ticket.lastUpdate.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const bodyPreview = (ticket.body || '').substring(0, 60) + (ticket.body?.length > 60 ? '...' : '');
        const isUnread = ticket.status === 'Open';

        return `
        <div class="p2p-thread-item ${isUnread ? 'is-unread' : ''}" onclick="loadConversationPanel('${ticket.id}')" id="thread-${ticket.id}">
            <div class="p2p-thread-avatar" style="background:${avatarBg};">
                ${ticket.isSystemMessage ? '<i class="fas fa-bell"></i>' : initials}
            </div>
            <div class="p2p-thread-body">
                <div class="p2p-thread-top">
                    <span class="p2p-thread-name">${ticket.subject}</span>
                    <span class="p2p-thread-time">${dateStr}</span>
                </div>
                <div class="p2p-thread-bottom">
                    <span class="p2p-thread-preview">${bodyPreview || 'No message body.'}</span>
                    <span class="p2p-status-dot" style="background:${statusColor};" title="${ticket.status}"></span>
                </div>
            </div>
        </div>`;
    }).join('');
}

// Global active chat listener for real-time updates
window.currentChatListener = null;

// Back button action for mobile responsive view
window.goBackToThreadList = function goBackToThreadList() {
    const layout = document.querySelector('.p2p-chat-layout');
    if (layout) layout.classList.remove('chat-active');
    
    // Clear active chat listener when leaving the conversation panel
    if (window.currentChatListener) {
        window.currentChatListener();
        window.currentChatListener = null;
    }
    
    document.querySelectorAll('.p2p-thread-item').forEach(el => el.classList.remove('is-active'));
};

async function loadConversationPanel(ticketId) {
    // Add mobile active-chat class
    const layout = document.querySelector('.p2p-chat-layout');
    if (layout) layout.classList.add('chat-active');

    // Clear existing chat listener
    if (window.currentChatListener) {
        window.currentChatListener();
        window.currentChatListener = null;
    }

    // Highlight selected thread
    document.querySelectorAll('.p2p-thread-item').forEach(el => el.classList.remove('is-active'));
    const threadEl = document.getElementById(`thread-${ticketId}`);
    if (threadEl) threadEl.classList.add('is-active');

    const panel = document.getElementById('p2pConversationPanel');
    panel.innerHTML = `<div class="p2p-loading-chat"><i class="fas fa-circle-notch fa-spin"></i></div>`;

    try {
        const tickets = await DataStore.getTickets();
        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket) throw new Error('Thread not found');

        const isAdmin = currentUser.role === 'admin';
        const canReply = ticket.status !== 'Closed';
        const originalDate = ticket.createdAt?.toDate ? ticket.createdAt.toDate().toLocaleString() : '';

        // Render skeleton template
        panel.innerHTML = `
        <div class="p2p-panel-header">
            <div class="p2p-panel-info">
                <button class="btn btn-icon p2p-back-btn" onclick="goBackToThreadList()"><i class="fas fa-arrow-left"></i></button>
                <div class="p2p-panel-avatar">${ticket.isSystemMessage ? '<i class="fas fa-bell"></i>' : (ticket.userEmail || 'U').substring(0, 2).toUpperCase()}</div>
                <div>
                    <div class="p2p-panel-name">${ticket.subject}</div>
                    <div class="p2p-panel-sub">${ticket.userEmail} &bull; <span class="ticket-status-badge status-${ticket.status.toLowerCase()}">${ticket.status}</span></div>
                </div>
            </div>
            <div style="display:flex;gap:8px;">
                ${isAdmin && ticket.status !== 'Closed' ? `<button class="btn btn-sm btn-danger" onclick="closeTicket('${ticketId}')"><i class="fas fa-lock"></i> Close</button>` : ''}
            </div>
        </div>

        <div class="p2p-chat-log" id="p2pChatLog">
            <div class="p2p-date-divider">${originalDate}</div>
            <div class="p2p-msg is-other">
                <div class="p2p-msg-bubble">
                    <div class="p2p-msg-author">${ticket.userEmail} <span class="p2p-msg-role-badge">Original</span></div>
                    ${ticket.body}
                </div>
            </div>
            <!-- Replies will load dynamically here -->
        </div>

        ${canReply ? `
        <form class="p2p-reply-bar" id="p2pReplyForm" onsubmit="submitP2PReply(event, '${ticketId}')">
            <input type="text" id="p2pReplyInput" class="form-control" placeholder="Type a message..." autocomplete="off">
            <button type="submit" class="btn btn-primary p2p-send-btn"><i class="fas fa-paper-plane"></i></button>
        </form>` : `<div class="p2p-closed-bar"><i class="fas fa-lock"></i> This conversation is closed.</div>`}
        `;

        const logContainer = document.getElementById('p2pChatLog');

        // Setup real-time listener for the replies
        window.currentChatListener = db.collection('tickets').doc(ticketId).collection('replies')
            .orderBy('timestamp', 'asc')
            .onSnapshot(snapshot => {
                // Keep the static original message, remove any dynamic ones
                const staticNodes = Array.from(logContainer.querySelectorAll('.p2p-date-divider, .p2p-msg.is-other:first-of-type'));
                logContainer.innerHTML = '';
                staticNodes.forEach(node => logContainer.appendChild(node));

                snapshot.forEach(doc => {
                    const r = doc.data();
                    const isMe = r.senderId === currentUser.id;
                    const isSystem = r.role === 'system';
                    const msgDate = r.timestamp ? r.timestamp.toDate().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
                    const roleLabel = isSystem ? 'System' : (r.role === 'admin' ? 'Support' : '');
                    
                    const msgEl = document.createElement('div');
                    msgEl.className = `p2p-msg ${isMe ? 'is-me' : 'is-other'} ${isSystem ? 'is-system' : ''}`;
                    msgEl.innerHTML = `
                        <div class="p2p-msg-bubble">
                            ${!isMe ? `<div class="p2p-msg-author">${r.senderName} ${roleLabel ? `<span class="p2p-msg-role-badge">${roleLabel}</span>` : ''}</div>` : ''}
                            ${r.message}
                            <div class="p2p-msg-time">${msgDate}</div>
                        </div>
                    `;
                    logContainer.appendChild(msgEl);
                });

                // Scroll to bottom
                setTimeout(() => { logContainer.scrollTop = logContainer.scrollHeight; }, 100);
            }, err => {
                console.warn('Real-time replies failed, falling back to one-time load:', err);
                // Fallback to offline/request-based replies list
                loadRepliesOfflineFallback(ticketId, logContainer);
            });

    } catch (e) {
        panel.innerHTML = `<div class="p2p-empty-state"><i class="fas fa-exclamation-triangle"></i><h3>Error loading thread</h3><p>${e.message}</p></div>`;
    }
}

// Fallback method for offline or loading errors
async function loadRepliesOfflineFallback(ticketId, logContainer) {
    try {
        const replies = await DataStore.getTicketReplies(ticketId);
        replies.forEach(r => {
            const isMe = r.senderId === currentUser.id;
            const isSystem = r.role === 'system';
            const msgDate = r.timestamp ? r.timestamp.toDate().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
            const roleLabel = isSystem ? 'System' : (r.role === 'admin' ? 'Support' : '');
            
            const msgEl = document.createElement('div');
            msgEl.className = `p2p-msg ${isMe ? 'is-me' : 'is-other'} ${isSystem ? 'is-system' : ''}`;
            msgEl.innerHTML = `
                <div class="p2p-msg-bubble">
                    ${!isMe ? `<div class="p2p-msg-author">${r.senderName} ${roleLabel ? `<span class="p2p-msg-role-badge">${roleLabel}</span>` : ''}</div>` : ''}
                    ${r.message}
                    <div class="p2p-msg-time">${msgDate}</div>
                </div>
            `;
            logContainer.appendChild(msgEl);
        });
        setTimeout(() => { logContainer.scrollTop = logContainer.scrollHeight; }, 100);
    } catch(err) {
        console.error(err);
    }
}

async function submitP2PReply(event, ticketId) {
    event.preventDefault();
    const input = document.getElementById('p2pReplyInput');
    const message = input ? input.value.trim() : '';
    if (!message) return;

    const btn = event.target.querySelector('button');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    input.disabled = true;

    try {
        await DataStore.sendTicketReply(ticketId, {
            senderId: currentUser.id,
            senderName: currentUser.fullname || currentUser.username,
            role: currentUser.role,
            message
        });
        // Clear input field on success (real-time listener will fetch & render)
        if (input) {
            input.value = '';
            input.disabled = false;
            input.focus();
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        }
    } catch (err) {
        showToast(err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i>'; }
        if (input) input.disabled = false;
    }
}

window.loadConversationPanel = loadConversationPanel;
window.submitP2PReply = submitP2PReply;
/* ===== EMOJI PICKER LOGIC ===== */
const EMOJI_LIST = ['😀', '😁', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', 'AED', '🇿🇼', '🇿🇦', '🇺🇸', '📶', '🔥', '💨'];

function toggleEmojiPicker() {
    const picker = document.getElementById('emojiPicker');
    if (!picker) return;

    // Populate if empty
    if (picker.innerHTML.trim() === '') {
        picker.innerHTML = EMOJI_LIST.map(e =>
            `<button class="emoji-btn-select" onclick="insertEmoji('${e}')">${e}</button>`
        ).join('');
    }

    picker.classList.toggle('active');
}

function insertEmoji(char) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value += char;
        input.focus();
    }
    document.getElementById('emojiPicker').classList.remove('active');
}

/* ===================================================================
   GEMINI CHATBOT
   =================================================================== */
const HELP_DOCS = {
    "Getting Started": "Download the app, signup, and buy credits via voucher. Connect to the 'Power-HotSpot' SSID.",
    "Device Binding": "Br3eze uses Hardware ID (UUID) binding. Your account is locked to the first device you use. Contact support to reset.",
    "Data Quotas": "Plans now include bandwidth limits. Check your 'Usage' tab to see remaining GBs.",
    "Roaming": "Partner hotspots allow you to stay connected outside our main zones. Look for the '🌐' icon in the scan list.",
    "Missions": "Complete daily tasks to unlock connectivity perks and badges."
};
(() => {
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    let chatHistory = [];

    async function getSystemContext() {
        let context = `You are 'Br3eze', a helpful support assistant for an Internet Hotspot service in Africa.
      CURRENT USER DETAILS:
      - Name: ${currentUser ? currentUser.fullname : 'Guest'}
      - Username: ${currentUser ? currentUser.username : 'Guest'}
      - Balance: $${currentUser ? (currentUser.credits || 0).toFixed(2) : '0.00'}
      `;
        try {
            const plans = await DataStore.getPlans();
            if (plans.length > 0) {
                context += `\nAVAILABLE DATA PLANS (Sell these):`;
                plans.forEach(p => {
                    context += `\n- ${p.name}: $${p.price} (${p.durationValue || p.durationDays} ${p.durationUnit || 'days'}) - ${p.description}`;
                });
            } else {
                context += `\nNo plans are currently configured. Apologize to the user.`;
            }
        } catch (e) { console.error(e); }
        context += `\n\nGUIDELINES:
      1. Keep answers short (under 3 sentences).
      2. Be friendly and use emojis.
      3. If they want to buy a plan, tell them to go to the "Plans" tab.
      4. If they have connection issues, suggest they "forget the wifi network" and reconnect.
      5. Never give out free credit.`;
        return context;
    }

    let billingGroupTimeout = null;
    let billingGroupMessages = [];

    function addMessage(text, sender, iconClass = null) {
        const box = document.getElementById('chatLog');
        if (!box) return;

        // Handle billing grouping
        if (sender === 'billing') {
            billingGroupMessages.push(text);
            if (billingGroupTimeout) clearTimeout(billingGroupTimeout);
            billingGroupTimeout = setTimeout(() => flushBillingMessages(), 1000);
            return;
        }

        const div = document.createElement('div');
        div.className = `chat-message ${sender}`;

        let avatarHtml = '';
        if (sender === 'bot') {
            avatarHtml = `<div class="bot-avatar"><i class="${iconClass || 'fas fa-robot'}"></i></div>`;
        } else if (sender === 'system') {
            avatarHtml = `<div class="system-avatar"><i class="${iconClass || 'fas fa-bell'}"></i></div>`;
        } else if (sender === 'billing') {
            avatarHtml = `<div class="bot-avatar" style="background:var(--color-success);"><i class="fas fa-file-invoice-dollar"></i></div>`;
        }

        const bubbleClass = `bubble ${sender}`;
        div.innerHTML = avatarHtml + `<div class="${bubbleClass}">${text}</div>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    function flushBillingMessages() {
        if (billingGroupMessages.length === 0) return;
        const count = billingGroupMessages.length;
        const summary = count > 1
            ? `📊 <strong>Billing Summary</strong>: Processed ${count} transactions successfully.`
            : billingGroupMessages[0];

        billingGroupMessages = [];
        billingGroupTimeout = null;

        const box = document.getElementById('chatLog');
        const div = document.createElement('div');
        div.className = 'chat-message bot billing';
        div.innerHTML = `<div class="bot-avatar" style="background:var(--color-success);"><i class="fas fa-file-invoice-dollar"></i></div><div class="bubble bot">${summary}</div>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }

    async function sendGeminiMessage() {
        const input = document.getElementById('chatInput');
        const msg = input.value.trim();
        if (!msg) return;

        input.value = '';
        addMessage(msg, 'user');

        const box = document.getElementById('chatLog');
        const typingId = 'typing-' + Date.now();
        const typingDiv = document.createElement('div');
        typingDiv.id = typingId;
        typingDiv.className = 'chat-message bot';
        typingDiv.innerHTML = `<div class="bot-avatar"><i class="fas fa-robot"></i></div><div class="bubble bot"><i class="fas fa-circle-notch fa-spin"></i></div>`;
        box.appendChild(typingDiv);
        box.scrollTop = box.scrollHeight;

        try {
            const systemInstruction = await getSystemContext();
            const contents = [
                { role: "user", parts: [{ text: systemInstruction }] },
                ...chatHistory,
                { role: "user", parts: [{ text: msg }] }
            ];
            const response = await fetch(GEMINI_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: contents,
                    generationConfig: { temperature: 0.7, maxOutputTokens: 200 }
                })
            });
            const data = await response.json();
            const tEl = document.getElementById(typingId);
            if (tEl) tEl.remove();

            if (data.error) {
                console.error("Gemini Error:", data.error);
                addMessage("⚠️ System overload. Please try again.", 'bot');
                return;
            }
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Pole, I didn't catch that.";
            addMessage(reply, 'bot');
            chatHistory.push({ role: "user", parts: [{ text: msg }] });
            chatHistory.push({ role: "model", parts: [{ text: reply }] });

            // Basic context trimming
            if (chatHistory.length > 10) chatHistory = chatHistory.slice(chatHistory.length - 10);

        } catch (error) {
            document.getElementById(typingId)?.remove();
            console.error("Network Error:", error);
            addMessage("Check your internet connection.", 'bot');
        }
    }

    // Global exports for Chat
    window.openChatBotModal = function () {
        const modal = document.getElementById('chatBoxModal');
        if (modal) modal.classList.add('active');
        const log = document.getElementById('chatLog');
        if (log && log.innerHTML.trim() === '') {
            addMessage(`Hello ${currentUser ? (currentUser.fullname.split(' ')[0] || 'there') : 'there'}! 👋\nI can help you with plans, connection issues, or vouchers.`, 'bot');
        }
    };
    window.sendChatMessage = sendGeminiMessage;
    window.addChatMessage = addMessage;
})();


class WiFiBillingAgentOS {
    constructor() {
        this.core = null;
        this.initialized = false;
    }

    async initialize() {
        console.log('[AgentOS] Initializing WiFi Billing Agent OS ...');

        // Initialize Core Agent
        this.core = new CoreAgent({
            agentId: `pc-os-${device?.uuid || 'web-' + Math.random().toString(36).substr(2, 9)}`,
            nodeType: this.detectNodeType(),
            heartbeatInterval: 30000
        });

        await this.core.initialize();

        // Register specialized agents
        await this.registerAgents();

        // Initialize gossip protocol for mesh networking
        await this.initializeGossip();

        // Start all agents
        await this.startAgents();

        this.initialized = true;
        console.log('[AgentOS] System initialized successfully');

        // Emit system ready event
        this.core.emit('os:ready', {
            version: '4.0.0',
            agents: Array.from(this.core.agents.keys()),
            timestamp: Date.now()
        });
    }

    async registerAgents() {
        // WiFi Agent
        const wifiAgent = new WiFiAgent({
            scanInterval: 10000,
            autoReconnect: true,
            preferredNetworks: ['PC-', 'PowerConnect']
        });
        this.core.registerAgent('wifi', wifiAgent);

        // Billing Agent
        const billingAgent = new BillingAgent({
            currency: 'USD',
            defaultRate: 0.10,
            billingInterval: 60000
        });
        this.core.registerAgent('billing', billingAgent);

        // Auth Agent
        const authAgent = new AuthAgent({
            tokenRefreshInterval: 300000,
            deviceProfiling: true
        });
        this.core.registerAgent('auth', authAgent);

        // Notification Agent
        const notificationAgent = new NotificationAgent({
            subtlePrompts: true,
            contextAware: true
        });
        this.core.registerAgent('notification', notificationAgent);

        // AI Orchestrator
        const aiOrchestrator = new AIOrchestrator({
            autonomyLevel: 'assisted',
            learningEnabled: true
        });
        this.core.registerAgent('ai', aiOrchestrator);
    }

    async initializeGossip() {
        if (typeof window.GossipNode === 'undefined') {
            console.warn('[AgentOS] GossipNode not found, skipping gossip initialization');
            return;
        }

        this.gossip = window.GossipNode;
        this.gossip.initialize(this.core);

        console.log('[AgentOS] Gossip protocol initialized');
    }

    start() {
        // Compatibility with index.js cleanup
        if (this.gossip && typeof this.gossip.start === 'function') {
            this.gossip.start();
        }
    }

    async startAgents() {
        const agentOrder = ['auth', 'wifi', 'billing', 'notification', 'ai'];

        for (const agentType of agentOrder) {
            try {
                await this.core.startAgent(agentType);
                console.log(`[AgentOS] Started ${agentType} agent`);
            } catch (error) {
                console.error(`[AgentOS] Failed to start ${agentType}:`, error);
            }
        }
    }

    detectNodeType() {
        if (typeof cordova !== 'undefined') {
            return 'mobile';
        }
        if (typeof window !== 'undefined' && window.process?.versions?.node) {
            return 'server';
        }
        return 'web';
    }

    // Public API for UI integration
    async connectToNetwork(ssid, password, options = {}) {
        const wifiAgent = this.core.agents.get('wifi');
        const billingAgent = this.core.agents.get('billing');

        // Check if billing network
        const networks = await wifiAgent.scan();
        const targetNetwork = networks.find(n => n.ssid === ssid);

        if (targetNetwork?.isBillingNetwork) {
            // Start billing session first
            const session = await billingAgent.startSession({
                userId: options.userId,
                planId: options.planId,
                ssid,
                timeLimit: options.timeLimit,
                dataLimit: options.dataLimit
            });

            // Connect with session
            return await wifiAgent.connect({
                ssid,
                password,
                session: session.id
            });
        }
        return await wifiAgent.connect({ ssid, password });
    }

    async getSystemStatus() {
        return {
            initialized: this.initialized,
            core: this.core.getStatus(),
            gossip: this.gossip ? this.gossip.getStats() : null,
            agents: Array.from(this.core.agents.entries()).map(([type, agent]) => ({
                type,
                state: agent.state,
                id: agent.id
            }))
        };
    }

    subscribeToEvents(event, callback) {
        return this.core.on(event, callback);
    }
}

// Initialize on device ready
document.addEventListener('deviceready', async () => {
    window.AgentOS = new WiFiBillingAgentOS();
    await window.AgentOS.initialize();
}, false);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WiFiBillingAgentOS;
}

/*  =====  GLOBAL EXPORTS  =====  */
window.showSection = showSection;
window.toggleDropdown = toggleDropdown;
window.openModal = UI.openModal;
window.closeModal = UI.closeModal;
window.Auth = Auth;
window.toggleAuthForm = toggleAuthForm;
window.openRedeemVoucher = openRedeemVoucher;
window.scanQRCode = scanQRCode;
window.stopQRScanner = stopQRScanner;
window.openShareCredit = openShareCredit;
window.openSubmitTicketModal = openSubmitTicketModal;
window.openAdminPlanModal = (id) => AppAdmin.openAdminPlanModal(id);
window.openAdminUserModal = (id) => AppAdmin.openAdminUserModal(id);
window.openGenerateVoucherModal = () => AppAdmin.openGenerateVoucherModal();
window.openEditNetworkModal = () => window.openModal('adminNetworkModal');
window.openSendVoucherModal = (id, c, v) => AppAdmin.openSendVoucherModal(id, c, v);
window.purchasePlan = purchasePlan;
window.deleteVoucher = (id) => AppAdmin.deleteVoucher(id);
window.deleteAdminPlan = (id) => AppAdmin.deleteAdminPlan(id);
window.closeTicket = (id) => AppAdmin.closeTicket(id);
window.revealPassword = (e, p) => AppAdmin.revealPassword(e, p);
window.openTicketDetail = (id) => AppAdmin.openTicketDetail(id);
window.renderUserManagement = () => AppAdmin.renderUserManagement();
window.renderVoucherList = () => AppAdmin.renderVoucherList();
window.bulkPrintVouchers = () => AppAdmin.bulkPrintVouchers();
window.confirmBulkPrint = () => AppAdmin.confirmBulkPrint();
window.toggleAllVouchers = (m) => AppAdmin.toggleAllVouchers(m);
window.updateSelectedCount = () => AppAdmin.updateSelectedCount();
window.updateTransactionHistory = updateTransactionHistory;
window.openActiveConnectionsModal = openActiveConnectionsModal;
window.filterConnectionsTable = filterConnectionsTable;
window.openAdminAI = openAdminAI;
window.toggleEmojiPicker = toggleEmojiPicker;
window.insertEmoji = insertEmoji;
window.renderMessagesSection = () => AppAdmin.renderMessagesSection();
window.handlePlanImageSelection = () => AppAdmin.handlePlanImageSelection();

/* ===== P2P Messaging & Contacts Integration ===== */

// Initialize mock contacts database in localStorage if empty
function initMockContacts() {
    if (!localStorage.getItem('mock_contacts')) {
        const defaultMockContacts = [
            {
                id: 'mock-1',
                displayName: 'Alice Smith',
                emails: [{ value: 'alice.smith@google.com' }],
                phoneNumbers: [{ value: '+27 82 123 4567' }],
                note: 'Starlink Hotspot Partner'
            },
            {
                id: 'mock-2',
                displayName: 'Bob Jones (Br3eze Support)',
                emails: [{ value: 'support@br3eze.africa' }],
                phoneNumbers: [{ value: '+27 83 987 6543' }],
                note: '[P2P-UUID: 8a93342b-11e3-4f30-82cb-18bfc5366733]\nNetwork Operations Center Contact'
            },
            {
                id: 'mock-3',
                displayName: 'Charlie Doe',
                emails: [],
                phoneNumbers: [{ value: '+1 555-0199' }],
                note: ''
            }
        ];
        localStorage.setItem('mock_contacts', JSON.stringify(defaultMockContacts));
    }
}

// Render the list of mock contacts inside the modal
function renderMockContacts() {
    initMockContacts();
    const listContainer = document.getElementById('mockContactsList');
    if (!listContainer) return;
    
    const contacts = JSON.parse(localStorage.getItem('mock_contacts'));
    listContainer.innerHTML = contacts.map(c => {
        const initial = c.displayName.charAt(0).toUpperCase();
        const contactInfo = c.emails?.[0]?.value || c.phoneNumbers?.[0]?.value || 'No email or phone';
        return `
        <div class="mock-contact-item" onclick="selectMockContact('${c.id}')">
            <div class="mock-contact-avatar">${initial}</div>
            <div class="mock-contact-details">
                <span class="mock-contact-name">${c.displayName}</span>
                <span class="mock-contact-info">${contactInfo}</span>
            </div>
        </div>`;
    }).join('');
}

// Select a mock contact and run the UUID P2P messaging flow
window.selectMockContact = async function selectMockContact(contactId) {
    const contacts = JSON.parse(localStorage.getItem('mock_contacts'));
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    
    closeModal('mockContactsModal');
    Loading.show('Processing contact P2P status...');
    
    try {
        const note = contact.note || '';
        const match = note.match(/P2P-UUID:\s*([a-f0-9-]{36})/i);
        let targetUuid;
        
        if (match) {
            targetUuid = match[1];
            showToast('Found synced P2P UUID: ' + targetUuid, 'info');
        } else {
            // Generate a new UUIDv4
            targetUuid = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
            );
            
            // Update mock contact note
            const uuidString = `[P2P-UUID: ${targetUuid}]`;
            contact.note = note ? `${note}\n${uuidString}` : uuidString;
            localStorage.setItem('mock_contacts', JSON.stringify(contacts));
            showToast('Generated new P2P UUID & synced with mock Google Contacts!', 'success');
        }
        
        await initiateP2PChatThread(targetUuid, contact);
    } catch (e) {
        showToast('Error selecting contact: ' + e.message, 'error');
    } finally {
        Loading.hide();
    }
};

// Core function to create or open a P2P chat thread in Firestore
async function initiateP2PChatThread(uuid, contact) {
    const ticketRef = db.collection('tickets').doc(uuid);
    const doc = await ticketRef.get();
    
    const contactName = contact.displayName || 'P2P Contact';
    const contactInfo = contact.emails?.[0]?.value || contact.phoneNumbers?.[0]?.value || 'no-contact-info';
    
    if (!doc.exists) {
        await ticketRef.set({
            userId: currentUser.id,
            userEmail: contactInfo,
            subject: `P2P Chat: ${contactName}`,
            body: `Direct P2P messaging session started with ${contactName}.`,
            status: 'Open',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp(),
            isP2P: true,
            p2pUuid: uuid,
            p2pContactName: contactName
        });
    }
    
    // Refresh conversation list & load the panel
    await renderMessagesSection();
    await loadConversationPanel(uuid);
}

// Hook up the form to add a new custom mock contact
document.getElementById('addMockContactForm')?.addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('mockContactName').value.trim();
    const info = document.getElementById('mockContactInfo').value.trim();
    if (!name || !info) return;
    
    const contacts = JSON.parse(localStorage.getItem('mock_contacts') || '[]');
    const isEmail = info.includes('@');
    
    const newContact = {
        id: 'mock-' + Date.now(),
        displayName: name,
        emails: isEmail ? [{ value: info }] : [],
        phoneNumbers: !isEmail ? [{ value: info }] : [],
        note: ''
    };
    
    contacts.push(newContact);
    localStorage.setItem('mock_contacts', JSON.stringify(contacts));
    
    // Reset form fields
    document.getElementById('mockContactName').value = '';
    document.getElementById('mockContactInfo').value = '';
    
    // Re-render and pick it automatically
    renderMockContacts();
    selectMockContact(newContact.id);
});

// The main pickContactForChat function bound to the UI button
window.pickContactForChat = function pickContactForChat() {
    if (!navigator.contacts) {
        // Non-Cordova web / simulation mode
        renderMockContacts();
        openModal('mockContactsModal');
        return;
    }
    
    // Cordova Mobile Context
    Loading.show('Accessing contacts...');
    navigator.contacts.pickContact(async function(contact) {
        Loading.hide();
        console.log('Selected native contact: ' + JSON.stringify(contact));
        
        try {
            const note = contact.note || '';
            const match = note.match(/P2P-UUID:\s*([a-f0-9-]{36})/i);
            let targetUuid;
            
            if (match) {
                targetUuid = match[1];
                showToast('P2P UUID resolved: ' + targetUuid, 'info');
                await initiateP2PChatThread(targetUuid, contact);
            } else {
                // Generate a new UUIDv4
                targetUuid = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
                );
                
                // Update native contact note
                const uuidString = `[P2P-UUID: ${targetUuid}]`;
                contact.note = note ? `${note}\n${uuidString}` : uuidString;
                
                Loading.show('Syncing UUID with Google Contacts...');
                contact.save(async function(savedContact) {
                    showToast('P2P UUID updated & synced to Google Contacts!', 'success');
                    await initiateP2PChatThread(targetUuid, savedContact);
                    Loading.hide();
                }, async function(err) {
                    console.warn('Native contact save failed, proceeding with P2P creation anyway: ', err);
                    showToast('Google Contacts read-only. Proceeding with P2P chat.', 'warning');
                    await initiateP2PChatThread(targetUuid, contact);
                    Loading.hide();
                });
            }
        } catch (e) {
            showToast('Error setting up P2P: ' + e.message, 'error');
            Loading.hide();
        }
    }, function(err) {
        Loading.hide();
        console.warn('Contacts picker error/cancelled: ' + err);
        showToast('Contacts selection cancelled', 'info');
    });
};