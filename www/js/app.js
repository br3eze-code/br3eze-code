  /*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

  // ===================================
    // FIREBASE & CORE APP SETUP
    // ===================================
    
    const firebaseConfig = {
        apiKey: "AIzaSyANPQZKsAV9VsW9vKZJ3ghhrpnkxuLfdP8",
      authDomain: "br3eze-africa-312df.firebaseapp.com",
  databaseURL: "https://br3eze-africa-312df-default-rtdb.firebaseio.com",
  projectId: "br3eze-africa-312df",
  storageBucket: "br3eze-africa-312df.firebasestorage.app",
  messagingSenderId: "123902078923",
  appId: "1:123902078923:web:1153a45add9fe25208504e",
  measurementId: "G-Y6YS53B86S"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let connectionCheckInterval = null

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------

    const Auth = {
        async login(email, password) {
            try {
                await auth.signInWithEmailAndPassword(email, password);
            } catch (e) {
                showToast(e.message, 'error');
            }
        },
        async signup(email, password, fullname,confirmPassword) {
            if(password !== confirmPassword){
                showToast('Passwords do not match','error');
                return;
            }
            try {
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;
                const newUserProfile = {
                    uid: user.uid,
                    email: user.email,
                    fullname: fullname,
                    role: 'user',
                    credits: 10.00, // Welcome bonus
                    subscriptions: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await db.collection('users').doc(user.uid).set(newUserProfile);
                showToast('Account created successfully! Please login.', 'success');
                toggleAuthForm();
                document.getElementById('loginEmail').value = email;
            } catch (e) {
                showToast(e.message, 'error');
            }
        },
        async logout() {
            if (connectionCheckInterval) {
                clearInterval(connectionCheckInterval);
            }
            await auth.signOut();
            showToast('Logged out', 'info');
        },
        async loginWithGoogle() {
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                const { user } = await auth.signInWithPopup(provider);
                const existing = await db.collection('users').doc(user.uid).get();
                if (!existing.exists) {
                    await db.collection('users').doc(user.uid).set({
                        uid: user.uid,
                        email: user.email,
                        fullname: user.displayName || user.email,
                        role: 'user',
                        credits: 10.00, // Welcome bonus
                        subscriptions: [],
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            } catch (e) {
                if (e.code !== 'auth/popup-closed-by-user') {
                    showToast(e.message, 'error');
                }
            }
        }
    };
// ---------------------------------------------------------------------
// DATA STORE 
// ---------------------------------------------------------------------
    const DataStore = {
        async getUser(uid) {
            const doc = await db.collection('users').doc(uid).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        },
        async getAllUsers() {
            const snapshot = await db.collection('users').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        async updateUser(uid, data) {
            await db.collection('users').doc(uid).update(data);
        },
        async getPlans() {
            const snapshot = await db.collection('plans').orderBy('price').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        async savePlan(planId, data) {
            if (planId) {
                await db.collection('plans').doc(planId).set(data, { merge: true });
            } else {
                await db.collection('plans').add(data);
            }
        },
        async deletePlan(planId) {
            await db.collection('plans').doc(planId).delete();
        },
        async getTickets() {
            let query = db.collection('tickets').orderBy('lastUpdate', 'desc');
            if (currentUser && currentUser.role !== 'admin') {
                query = query.where('userId', '==', currentUser.id);
            }
            const snapshot = await query.get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        async addTicket(ticketData) {
            await db.collection('tickets').add(ticketData);
        },
        async updateTicketStatus(ticketId, status) {
            await db.collection('tickets').doc(ticketId).update({
                status: status,
                lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
            });
        },
        async getNetworkSettings() {
            const doc = await db.collection('settings').doc('network').get();
            return doc.exists ? doc.data() : { ssid: 'Power-HotSpot', password: 'PowerHotspotPass' };
        },
        async updateNetworkSettings(data) {
            await db.collection('settings').doc('network').set(data, { merge: true });
        },
        async addTransaction(data) {
            await db.collection('transactions').add({
                ...data,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        },
        async getTransactionsForUser(userId) {
            const snapshot = await db.collection('transactions').where('userId', '==', userId).orderBy('timestamp', 'desc').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        async getAllTransactions() {
            const snapshot = await db.collection('transactions').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        },
        async getVoucher(code) {
            const snapshot = await db.collection('vouchers').where('code', '==', code.toUpperCase()).limit(1).get();
            if (snapshot.empty) return null;
            const doc = snapshot.docs[0];
            return { id: doc.id, ...doc.data() };
        },
        async updateVoucher(id, data) {
            await db.collection('vouchers').doc(id).update(data);
        },
        async getAllVouchers() {
            const snapshot = await db.collection('vouchers').orderBy('createdAt', 'desc').get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
    };

// ===================================
// WIFI MANAGEMENT
// ===================================
async function checkAndRequestWifiPermissions() {
    if (typeof cordova === 'undefined' || cordova.platformId !== 'android') return true;
    try {
         const hasPermission = await new Promise((resolve, reject) => {
            cordova.plugins.diagnostic.isLocationAuthorized(resolve, reject);
        });

        if (hasPermission) {
            return true;
        }

        showToast('Location permission is required for WiFi control.', 'info');
        const status = await new Promise((resolve, reject) => {
            cordova.plugins.diagnostic.requestLocationAuthorization(resolve, reject);
        });
        
        if (status === cordova.plugins.diagnostic.permissionStatus.GRANTED || status === cordova.plugins.diagnostic.permissionStatus.GRANTED_WHEN_IN_USE) {
            showToast('Permission granted!', 'success');
            return true;
        } else {
            showToast('Permission denied. WiFi functions disabled.', 'error');
            return false;
        }
    } catch (e) {
        console.error("Permission check failed:", e);
        showToast('Failed to check permissions.', 'error');
        return false;
    }
}

    async function connectToHotspot() {
    if (!currentUser || typeof WifiWizard2 === 'undefined') return;
     showToast('Attempting to connect...', 'info');

    try {
        const settings = await DataStore.getNetworkSettings();
        const ssid = settings.ssid;
        const password = settings.password;

        // Only try to connect if not already connected
        const currentSsid = await WifiWizard2.getConnectedSSID();
          if (currentSsid === ssid) {
             console.log(`Connected to ${ssid}.`);
             return;
          }

        // Android: Add & connect
        if (typeof cordova !== 'undefined' && cordova.platformId === 'android') {
        await WifiWizard2.addNetwork({
            ssid: ssid,
            password: password,
            algorithm: 'WPA' // or detect
        });
        await WifiWizard2.connectNetwork(ssid,true);

        showToast(`Connected to ${ssid}`, 'info');
         } else {
            showToast(`Please connect to the "${ssid}" manually.`, 'info');
        }
    } catch (e) {
        console.error('Auto-connect failed:', e);
        showToast('Connect failed. Please Try Again.', 'warning');
         } finally {
            updateConnectionStatusUI();
    }
}
//helper : check if user needs Disconnect
function needsDisconnect() {
    if (!currentUser) return false;
    const activeSubs = (currentUser.subscriptions || [])
        .filter(s => new Date(s.expiresAt.seconds * 1000) > new Date());
    return (currentUser.credits <= 0 && activeSubs.length === 0);
}

async function disconnectFromNetwork() {
    if (typeof WifiWizard2 === 'undefined') return;

    try {
        const settings = await DataStore.getNetworkSettings();
        const ssid = settings.ssid;

        // Determine if we are currently on the managed hotspot
        let isConnected = false;
        try {
            const currentSsid = await WifiWizard2.getConnectedSSID();
            isConnected = (currentSsid === ssid);
        } catch (e) {
            console.warn('Failed to get current SSID:', e);
        }

        if (!isConnected) {
            console.log('Not connected to hotspot - no action needed');
            return;
        }

        if (typeof cordova !== 'undefined' && cordova.platformId === 'android') {
            await WifiWizard2.disconnectNetwork(ssid);
            showToast(`Disconnected from ${ssid}. Please purchase a plan.`, 'info');
        } else {
            showToast(`Disconnect from "${ssid}" WiFi manually.`, 'warning');
            if (typeof cordova !== 'undefined' && cordova.plugins?.settings) {
                cordova.plugins.settings.open("wifi", () => {}, () => {});
            }
        }

        if (needsDisconnect()) {
            await DataStore.addTransaction({
                userId: currentUser.id, type: 'network_disconnect', amount: 0,
                description: 'Auto-disconnect due to zero credits/plans'
            });
        }
    } catch (error) {
        console.error('Disconnect failed:', error);
        showToast('Failed to disconnect from network', 'error');
    } finally {
        updateConnectionStatusUI();
    }
}

async function updateConnectionStatusUI() {
    if (typeof WifiWizard2 === 'undefined') {
        document.getElementById('dashConnectionStatus').textContent = "N/A";
        return;
    }

    const statusEl = document.getElementById('dashConnectionStatus');
    const actionBtn = document.getElementById('hotspotActionButton');

    try {
        const settings = await DataStore.getNetworkSettings();
        const targetSsid = settings.ssid;
        const currentSsid = await WifiWizard2.getConnectedSSID();

        if (currentSsid === targetSsid) {
            statusEl.textContent = "Connected";
            statusEl.className = 'stat-value status-connected';
            actionBtn.innerHTML = `<i class="fas fa-times-circle"></i> Disconnect`;
            actionBtn.onclick = () => disconnectFromNetwork();
        } else {
            statusEl.textContent = "Disconnected";
            statusEl.className = 'stat-value status-disconnected';
            actionBtn.innerHTML = `<i class="fas fa-wifi"></i> Connect to Hotspot`;
            actionBtn.onclick = () => connectToHotspot();
        }
    } catch (e) {
        statusEl.textContent = "Disconnected";
        statusEl.className = 'stat-value status-disconnected';
        actionBtn.innerHTML = `<i class="fas fa-wifi"></i> Connect to Hotspot`;
        actionBtn.onclick = () => connectToHotspot();
        console.log("Could not get SSID, assuming disconnected.");
    }
}

    // ===================================
    // APP INITIALIZATION & STATE
    // ===================================
    
    document.addEventListener('DOMContentLoaded', () => {
        auth.onAuthStateChanged(async user => {
            if (user) {
                currentUser = await DataStore.getUser(user.uid);
                if (currentUser) {
                    showMainApp();
                } else {
                    console.error("User profile not found in Firestore.");
                    Auth.logout();
                }
            } else {
                currentUser = null;
                showAuthScreen();
            }
        });

        // Bind form listeners
        document.getElementById('loginFormElement').addEventListener('submit', (e) => { e.preventDefault(); Auth.login(document.getElementById('loginIdentifier').value, document.getElementById('loginPassword').value); });
        document.getElementById('signupFormElement').addEventListener('submit', (e) => { e.preventDefault(); Auth.signup(document.getElementById('signupEmail').value, document.getElementById('signupPassword').value, document.getElementById('signupFullname').value,document.getElementById('signupConfirmPassword').value); });
        document.getElementById('newTicketForm').addEventListener('submit', submitNewTicket);
        document.getElementById('adminUserForm').addEventListener('submit', saveAdminUser);
        document.getElementById('adminPlanForm').addEventListener('submit', saveAdminPlan);
        document.getElementById('adminNetworkForm').addEventListener('submit', saveNetworkSettings);
        document.getElementById('redeemVoucherForm').addEventListener('submit', redeemVoucher);
        document.getElementById('generateVoucherForm').addEventListener('submit', generateVouchers);
    });

// ---------------------------------------------------------------------
// UI HELPERS
// ---------------------------------------------------------------------
    function showAuthScreen() {
        document.getElementById('authScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('mainHeader').style.display = 'none';
    }

    async function showMainApp() {
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        document.getElementById('mainHeader').style.display = 'flex';
        
        if (currentUser.role === 'admin') {
             document.getElementById('adminToolsContainer').classList.remove('hidden');
        } else {
             document.getElementById('adminToolsContainer').classList.add('hidden');
        }
        
        configureSidebarForUser();
        updateUI();
        showSection('home');

        if (connectionCheckInterval) clearInterval(connectionCheckInterval);
          // 1. First, ensure we have permissions
        const hasPermissions = await checkAndRequestWifiPermissions();
        if (hasPermissions) {
            if (needsDisconnect()) {
                showToast('Access expired. Disconnecting from network...', 'warning');
                await disconnectFromNetwork();
            } else {
                // User should have access, so let's try to connect them.
                await connectToHotspot();
            }
        }
              connectionCheckInterval = setInterval(() => {
            updateConnectionStatusUI();
            if(needsDisconnect()) disconnectFromNetwork();
        }, 10000); // Check every 10 seconds
    }


    function toggleAuthForm() {
        document.getElementById('loginForm').classList.toggle('hidden');
        document.getElementById('signupForm').classList.toggle('hidden');
    }
    
    // ===================================
    // ROLE-BASED UI & NAVIGATION
    // ===================================

    function configureSidebarForUser() {
        const plansLink = document.getElementById('sidebarPlansLink');
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
        if (dropdown) {
            const isVisible = dropdown.style.display === 'block';
            document.querySelectorAll('.user-dropdown, .header-dropdown-nav').forEach(d => d.style.display = 'none');
            dropdown.style.display = isVisible ? 'none' : 'block';
        }
    }

    function toggleMobileNav(navId) {
         const nav = document.getElementById(navId);
         if (nav) {
             const isVisible = nav.style.display === 'block';
             document.querySelectorAll('.user-dropdown, .header-dropdown-nav').forEach(d => d.style.display = 'none');
             nav.style.display = isVisible ? 'none' : 'block';
         }
    }

    function showSection(sectionId) {
        document.querySelectorAll('.dashboard-section').forEach(s => s.classList.add('hidden'));
        document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));

        const targetSection = document.getElementById(`${sectionId}-section`);
        const targetLi = document.querySelector(`.sidebar li[data-section="${sectionId}"]`);
        
        if(targetSection) targetSection.classList.remove('hidden');
        if(targetLi) targetLi.classList.add('active');
        
        switch(sectionId) {
            case 'messages': renderMessagesSection(); break;
            case 'orders': updateTransactionHistory(); break;
            case 'subscriptions': updatePlans(); break;
            case 'settings': updateSettingsFields(); break;
            case 'admin-stats': renderAdminStats(); break;
        }
        
        document.getElementById('mobileNavDropdown').style.display = 'none';
    }

    // ===================================
    // UI & DATA RENDERING FUNCTIONS
    // ===================================
    
    async function updateUI() {
        if (!currentUser) return;
        currentUser = await DataStore.getUser(currentUser.id); // Refresh user data
        updateNavbar();
        updateDashboard();
        if (currentUser.role === 'admin') {
            renderUserManagement();
            renderPlanManagementAdmin();
            renderVoucherList();
            renderNetworkSettings();
        }
    }
    
    function updateNavbar() {
        document.getElementById('navUsername').textContent = currentUser.fullname;
        const initials = (currentUser.fullname || 'U').split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
        document.getElementById('navUsernameShort').textContent = initials;
        document.getElementById('dropdownFullname').textContent = currentUser.fullname;
        document.getElementById('dropdownEmail').textContent = currentUser.email + (currentUser.role === 'admin' ? ' (Admin)' : '');
    }

    function updateDashboard() {
        document.getElementById('dashCredits').textContent = (currentUser.credits || 0).toFixed(2);
        const activeSubscriptions = (currentUser.subscriptions || []).filter(s => new Date(s.expiresAt.seconds * 1000) > new Date());
        document.getElementById('dashPlans').textContent = activeSubscriptions.length;
        const totalDevices = activeSubscriptions.length > 0 ? 1 : 0; // Simplified for now
        document.getElementById('dashDevices').textContent = totalDevices;
        document.getElementById('dashUptime').textContent = totalDevices > 0 ? 'Online' : 'Offline';
    }

    async function updatePlans() {
        const plans = await DataStore.getPlans();
        const container = document.getElementById('plansList');
        if (plans.length === 0) {
            container.innerHTML = `<p class="text-medium">No plans are available at the moment. Please check back later.</p>`;
            return;
        }
        container.innerHTML = plans.map(plan => `
            <div class="card plan-card">
                <h3>${plan.name}</h3>
                <p style="color: var(--color-text-medium);">${plan.description}</p>
                <div class="price">$${plan.price.toFixed(2)}</div>
                <ul>
                    <li><i class="fas fa-check"></i> ${plan.deviceLimit} device${plan.deviceLimit > 1 ? 's' : ''}</li>
                    <li><i class="fas fa-check"></i> ${plan.durationDays} day${plan.durationDays > 1 ? 's' : ''} access</li>
                </ul>
                <button class="btn btn-primary btn-block" onclick="purchasePlan('${plan.id}')">
                    Purchase ($${plan.price.toFixed(2)})
                </button>
            </div>
        `).join('');
    }

    async function updateTransactionHistory() {
        const container = document.getElementById('transactionHistoryContainer');
        container.innerHTML = `<p class="text-medium" style="padding: 25px;">Loading transaction history...</p>`;
        const transactions = await DataStore.getTransactionsForUser(currentUser.id);

        if (transactions.length === 0) {
            container.innerHTML = `<p class="text-medium" style="padding: 25px;">No transactions found.</p>`;
            return;
        }

        let html = `<table class="admin-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>`;
        transactions.forEach(tx => {
            const amountColor = tx.amount < 0 ? 'var(--color-danger-text)' : 'var(--color-success-text)';
            const sign = tx.amount > 0 ? '+' : '';
            html += `
                <tr>
                    <td style="color: var(--color-text-medium);">${tx.timestamp.toDate().toLocaleString()}</td>
                    <td>${tx.description}</td>
                    <td style="color: ${amountColor}; font-weight: 600;">${sign}$${tx.amount.toFixed(2)}</td>
                </tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    async function renderMessagesSection() {
        const container = document.getElementById('ticketListContainer');
        container.innerHTML = `<p class="text-medium" style="padding: 25px;">Loading tickets...</p>`;
        const tickets = await DataStore.getTickets();

        if (tickets.length === 0) {
            container.innerHTML = `<p class="text-medium" style="padding: 25px;">No support tickets found.</p>`;
            return;
        }
        let html = `<table class="admin-table"><thead><tr><th>ID</th><th>Subject</th><th>Submitted By</th><th>Status</th><th></th></tr></thead><tbody>`;
        tickets.forEach(ticket => {
            const statusClass = `status-${ticket.status.toLowerCase()}`;
            html += `<tr onclick="openTicketDetail('${ticket.id}')" style="cursor: pointer;"><td>${ticket.id.substring(0,8)}...</td><td>${ticket.subject}</td><td style="color: var(--color-text-medium);">${ticket.userEmail}</td><td><span class="ticket-status-badge ${statusClass}">${ticket.status}</span></td><td style="text-align: right;"><i class="fas fa-chevron-right" style="color: var(--color-text-medium);"></i></td></tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    }
    
    async function updateSettingsFields() {
         const network = await DataStore.getNetworkSettings();
         document.getElementById('qrDataInput').value = `WIFI:S:${network.ssid};T:WPA;P:${network.password};H:false;`;
         generateQrCode();
    }

    // ===================================
    // FEATURE IMPLEMENTATIONS
    // ===================================
    
    async function purchasePlan(planId) {
        const plans = await DataStore.getPlans();
        const plan = plans.find(p => p.id === planId);
        if (!plan) { return showToast('Plan not found.', 'error'); }

        if (currentUser.credits < plan.price) { return showToast('Insufficient credits to purchase this plan.', 'error'); }

        if (!confirm(`Confirm purchase of "${plan.name}" for $${plan.price.toFixed(2)}?`)) return;

        try {
            const now = new Date();
            const expires = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
            
            const newSubscription = {
                planId: plan.id,
                planName: plan.name,
                purchasedAt: firebase.firestore.Timestamp.fromDate(now),
                expiresAt: firebase.firestore.Timestamp.fromDate(expires)
            };
            
            // Update user document
            await DataStore.updateUser(currentUser.id, {
                credits: firebase.firestore.FieldValue.increment(-plan.price),
                subscriptions: firebase.firestore.FieldValue.arrayUnion(newSubscription)
            });

            // Log transaction
            await DataStore.addTransaction({
                userId: currentUser.id,
                type: 'purchase',
                description: `Plan Purchase: ${plan.name}`,
                amount: -plan.price
            });

            showToast('Plan purchased successfully!', 'success');
            await updateUI();
        } catch (e) {
            showToast(`Error purchasing plan: ${e.message}`, 'error');
        }
    }

    function openRedeemVoucher() {
        document.getElementById('redeemVoucherForm').reset();
        openModal('redeemVoucherModal');
    }

    async function redeemVoucher(event) {
        event.preventDefault();
        const code = document.getElementById('voucherCodeInput').value.trim();
        if (!code) return;

        try {
            const voucher = await DataStore.getVoucher(code);

            if (!voucher || voucher.used) {
                return showToast('Invalid or already used voucher code.', 'error');
            }

            await DataStore.updateUser(currentUser.id, {
                credits: firebase.firestore.FieldValue.increment(voucher.value)
            });

            await DataStore.addTransaction({
                userId: currentUser.id,
                type: 'redeem',
                description: `Voucher Redeemed: ${voucher.code}`,
                amount: voucher.value
            });

            await DataStore.updateVoucher(voucher.id, {
                used: true,
                usedBy: currentUser.id,
                usedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            showToast(`Successfully redeemed $${voucher.value.toFixed(2)}!`, 'success');
            closeModal('redeemVoucherModal');
            await updateUI();
        } catch (e) {
            showToast(`Error redeeming voucher: ${e.message}`, 'error');
        }
    }

    function openShareCredit() { showToast('Credit sharing is not yet implemented.', 'info'); }

    async function openTicketDetail(ticketId) {
        const tickets = await DataStore.getTickets();
        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket) { showToast('Ticket not found.', 'error'); return; }

        document.getElementById('ticketModalTitle').textContent = ticket.subject;
        document.getElementById('ticketModalId').textContent = ticket.id;
        document.getElementById('ticketModalStatus').innerHTML = `<span class="ticket-status-badge status-${ticket.status.toLowerCase()}">${ticket.status}</span>`;
        document.getElementById('ticketModalDate').textContent = ticket.lastUpdate.toDate().toLocaleString();
        document.getElementById('ticketModalBody').textContent = ticket.body;
        document.getElementById('ticketModalUser').textContent = ticket.userEmail;

        const actionsContainer = document.getElementById('ticketModalActions');
        actionsContainer.innerHTML = '';
        if (currentUser.role === 'admin' && ticket.status === 'Open') {
            actionsContainer.innerHTML += `<button class="btn btn-danger" onclick="closeTicket('${ticket.id}')"><i class="fas fa-check-circle"></i> Close Ticket</button>`;
        } else {
            actionsContainer.innerHTML += `<button class="btn" disabled>Status: ${ticket.status}</button>`;
        }
        openModal('ticketDetailModal');
    }

    async function closeTicket(ticketId) {
        if (!confirm(`Are you sure you want to mark ticket ${ticketId} as CLOSED?`)) return;
        try {
            await DataStore.updateTicketStatus(ticketId, 'Closed');
            closeModal('ticketDetailModal');
            showToast(`Ticket marked as Closed.`, 'success');
            renderMessagesSection();
        } catch (e) { showToast(`Error closing ticket: ${e.message}`, 'error'); }
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
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await DataStore.addTicket(newTicket);
            closeModal('submitTicketModal');
            showToast(`Ticket submitted successfully!`, 'success');
            renderMessagesSection();
        } catch(e) { showToast(`Error submitting ticket: ${e.message}`, 'error'); }
    }
    
    // ===================================
    // ADMIN-SPECIFIC FUNCTIONS
    // ===================================
    
    async function renderAdminStats() {
    const users = await DataStore.getAllUsers();
    const transactions = await DataStore.getAllTransactions();
    const tickets = await DataStore.getTickets();

  // ---- REVENUE: only plan purchases (positive amount) ----
    const revenue = transactions
        .filter(t => t.type === 'purchase' && t.amount > 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const activePlans = users.reduce((cnt, u) => cnt + (u.subscriptions?.filter(s => 
        new Date(s.expiresAt.seconds * 1000) > new Date()).length || 0), 0);
        
        document.getElementById('statsTotalRevenue').textContent = revenue.toFixed(2);
        document.getElementById('statsTotalUsers').textContent = users.length;
        document.getElementById('statsActivePlans').textContent = activePlans;
        document.getElementById('statsOpenTickets').textContent = tickets.filter(t => t.status === 'Open').length;

        // User Trend Chart
        const chartContainer = document.getElementById('userTrendChart');
        const days = Array(7).fill(0).map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            return { date: d.toISOString().split('T')[0], label: d.toLocaleDateString('en-US', { weekday: 'short' }), count: 0 };
        }).reverse();
        
        users.forEach(user => {
            if (user.createdAt) {
                const signupDate = user.createdAt.toDate().toISOString().split('T')[0];
                const day = days.find(d => d.date === signupDate);
                if (day) day.count++;
            }
        });

        const maxCount = Math.max(...days.map(d => d.count), 1);
        chartContainer.innerHTML = days.map(day => `
            <div class="chart-bar-wrapper">
                <div class="chart-bar" style="height: ${(day.count / maxCount) * 100}%;">
                    <span class="value">${day.count}</span>
                </div>
                <div class="chart-label">${day.label}</div>
            </div>
        `).join('');
    }
    
    // ---------------------------------------------------------------------
// SETTINGS 
// ---------------------------------------------------------------------
   function populateUserSettings() {
        if (!currentUser) return;
        document.getElementById('settingsFullname').value = currentUser.fullname;
        document.getElementById('settingsEmail').value = currentUser.email;
    }

     async function handleUpdateProfile(event) {
        event.preventDefault();
        const newName = document.getElementById('settingsFullname').value.trim();
        if (newName === currentUser.fullname) {
            return showToast('No changes to save.', 'info');
        }
        try {
            await DataStore.updateUser(currentUser.id, { fullname: newName });
            await updateUI(); // Refresh UI with new name
            showToast('Profile updated successfully!', 'success');
        } catch (e) {
            showToast(`Error updating profile: ${e.message}`, 'error');
        }
    }
async function renderUserManagement() {
        const container = document.getElementById('userListContainer');
        container.innerHTML = `<p class="text-medium">Loading users...</p>`;
        const users = await DataStore.getAllUsers();
        let html = `<table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Credits</th><th>Role</th><th></th></tr></thead><tbody>`;
        users.forEach(user => {
            html += `<tr><td>${user.fullname}</td><td>${user.email}</td><td>$${(user.credits || 0).toFixed(2)}</td><td>${user.role}</td><td style="text-align: right;"><button class="btn btn-sm" onclick="openAdminUserModal('${user.id}')">Edit</button></td></tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    async function openAdminUserModal(userId) {
        const users = await DataStore.getAllUsers();
        const user = users.find(u => u.id === userId);
        if (!user) { showToast('User not found', 'error'); return; }
        document.getElementById('adminUserModalTitle').textContent = `Edit User: ${user.fullname}`;
        document.getElementById('adminUserId').value = user.id;
        document.getElementById('adminUserFullname').value = user.fullname;
        document.getElementById('adminUserEmail').value = user.email;
        document.getElementById('adminUserCredits').value = user.credits || 0;
        document.getElementById('adminUserRole').value = user.role;
        openModal('adminUserModal');
    }

    async function saveAdminUser(event) {
        event.preventDefault();
        const userId = document.getElementById('adminUserId').value;
        const data = {
            fullname: document.getElementById('adminUserFullname').value,
            credits: parseFloat(document.getElementById('adminUserCredits').value),
            role: document.getElementById('adminUserRole').value
        };
        try {
            await DataStore.updateUser(userId, data);
            closeModal('adminUserModal');
            showToast('User updated successfully!', 'success');
            renderUserManagement();
        } catch (e) { showToast(`Error updating user: ${e.message}`, 'error'); }
    }
    
    async function renderPlanManagementAdmin() {
        const container = document.getElementById('planListAdminContainer');
        container.innerHTML = `<p class="text-medium">Loading plans...</p>`;
        const plans = await DataStore.getPlans();
        let html = `<table class="admin-table"><thead><tr><th>Name</th><th>Price</th><th>Duration</th><th>Devices</th><th></th></tr></thead><tbody>`;
        plans.forEach(plan => {
            html += `<tr><td>${plan.name}</td><td>$${plan.price.toFixed(2)}</td><td>${plan.durationDays}d</td><td>${plan.deviceLimit}</td><td style="text-align: right;"><button class="btn btn-sm" onclick="openAdminPlanModal('${plan.id}')">Edit</button></td></tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    }

    async function openAdminPlanModal(planId = null) {
        document.getElementById('adminPlanForm').reset();
        document.getElementById('deletePlanBtn').classList.add('hidden');
        if (planId) {
            const plans = await DataStore.getPlans();
            const plan = plans.find(p => p.id === planId);
            if (plan) {
                document.getElementById('adminPlanModalTitle').textContent = `Edit Plan`;
                document.getElementById('adminPlanId').value = plan.id;
                document.getElementById('adminPlanName').value = plan.name;
                document.getElementById('adminPlanDesc').value = plan.description;
                document.getElementById('adminPlanPrice').value = plan.price;
                document.getElementById('adminPlanDuration').value = plan.durationDays;
                document.getElementById('adminPlanDevices').value = plan.deviceLimit;
                document.getElementById('deletePlanBtn').classList.remove('hidden');
                document.getElementById('deletePlanBtn').onclick = () => deleteAdminPlan(planId);
            }
        } else {
            document.getElementById('adminPlanModalTitle').textContent = `Add New Plan`;
        }
        openModal('adminPlanModal');
    }

    async function saveAdminPlan(event) {
        event.preventDefault();
        const planId = document.getElementById('adminPlanId').value || null;
        const data = {
            name: document.getElementById('adminPlanName').value,
            description: document.getElementById('adminPlanDesc').value,
            price: parseFloat(document.getElementById('adminPlanPrice').value),
            durationDays: parseInt(document.getElementById('adminPlanDuration').value),
            deviceLimit: parseInt(document.getElementById('adminPlanDevices').value)
        };
        try {
            await DataStore.savePlan(planId, data);
            closeModal('adminPlanModal');
            showToast('Plan saved successfully!', 'success');
            renderPlanManagementAdmin();
        } catch (e) { showToast(`Error saving plan: ${e.message}`, 'error'); }
    }
    
    async function deleteAdminPlan(planId) {
         if (confirm('Are you sure you want to delete this plan? This cannot be undone.')) {
             try {
                 await DataStore.deletePlan(planId);
                 closeModal('adminPlanModal');
                 showToast('Plan deleted successfully', 'success');
                 renderPlanManagementAdmin();
             } catch (e) {
                 showToast(`Error deleting plan: ${e.message}`, 'error');
             }
         }
    }
    
    async function renderVoucherList() {
        const container = document.getElementById('voucherListContainer');
        container.innerHTML = `<p class="text-medium">Loading vouchers...</p>`;
        const vouchers = await DataStore.getAllVouchers();
        let html = `<table class="admin-table"><thead><tr><th>Code</th><th>Value</th><th>Status</th><th>Used By</th></tr></thead><tbody>`;
        vouchers.forEach(v => {
            const status = v.used ? `<span style="color: var(--color-danger-text);">Used</span>` : `<span style="color: var(--color-success-text);">Active</span>`;
            html += `<tr><td>${v.code}</td><td>$${v.value.toFixed(2)}</td><td>${status}</td><td style="color: var(--color-text-medium);">${v.usedBy ? v.usedBy.substring(0,8)+'...' : 'N/A'}</td></tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    }
    
    function openGenerateVoucherModal() {
        document.getElementById('generateVoucherForm').reset();
        openModal('generateVoucherModal');
    }

    async function generateVouchers(event) {
        event.preventDefault();
        const value = parseFloat(document.getElementById('voucherValue').value);
        const quantity = parseInt(document.getElementById('voucherQuantity').value);
        if (isNaN(value) || isNaN(quantity) || value <= 0 || quantity <= 0 || quantity > 100) {
            return showToast('Invalid value or quantity (max 100).', 'error');
        }

        try {
            const batch = db.batch();
            for (let i = 0; i < quantity; i++) {
                const code = `STAR-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
                const voucherRef = db.collection('vouchers').doc();
                batch.set(voucherRef, {
                    code: code,
                    value: value,
                    used: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            await batch.commit();
            showToast(`${quantity} vouchers generated successfully!`, 'success');
            closeModal('generateVoucherModal');
            renderVoucherList();
        } catch(e) { showToast(`Error generating vouchers: ${e.message}`, 'error'); }
    }
    
    async function renderNetworkSettings() {
        const network = await DataStore.getNetworkSettings();
         document.getElementById('networkSettingsDisplay').innerHTML = `<p><strong>SSID:</strong> ${network.ssid}</p><p><strong>Password:</strong> <em class="text-medium">••••••••</em> <button class="btn btn-sm" onclick="revealPassword(event, '${network.password}')">Show</button></p>`;
        document.getElementById('adminNetworkSsid').value = network.ssid;
        document.getElementById('adminNetworkPassword').value = network.password;
    }
   function revealPassword(event, pwd) {
        if (currentUser.role !== 'admin') return showToast('Unauthorized', 'error');
        const btn = event.target;
        const passwordElement = btn.previousElementSibling; // The 'em' tag
        
        if (btn.textContent === 'Show') {
            passwordElement.textContent = pwd;
            btn.textContent = 'Hide';
        } else {
            passwordElement.textContent = '••••••••';
            btn.textContent = 'Show';
        }
    }

    function openEditNetworkModal() {
        openModal('adminNetworkModal');
    }
    async function saveNetworkSettings(event) {
        event.preventDefault();
        const data = {
            ssid: document.getElementById('adminNetworkSsid').value,
            password: document.getElementById('adminNetworkPassword').value
        };
        try {
            await DataStore.updateNetworkSettings(data);
            closeModal('adminNetworkModal');
            showToast('Network settings updated!', 'success');
            await updateSettingsFields(); // Fetches settings and updates QR
            await renderNetworkSettings(); // Updates admin display
        } catch (e) { showToast(`Error updating network: ${e.message}`, 'error'); }
    }
    
    // ===================================
    // UTILITY & STUB FUNCTIONS
    // ===================================

    function openModal(modalId) { document.getElementById(modalId)?.classList.add('active'); }
    function closeModal(modalId) { document.getElementById(modalId)?.classList.remove('active'); }
    // showToast/toastTimeout are provided by js/index.js (loaded before this file) --
    // redeclaring them here as `let`/`function` throws a SyntaxError (illegal
    // redeclaration across script tags) and used to silently break this entire file.

    function openChatBoxModal() {
        const chatLog = document.getElementById('chatLog');
        chatLog.innerHTML = `<div class="chat-message"><strong>Support Bot:</strong> Hello! How can I help you today? Please describe your issue.</div>`;
        openModal('chatBoxModal');
    }
    
    function sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        if (!message) return;

        const chatLog = document.getElementById('chatLog');
        chatLog.innerHTML += `<div class="chat-message" style="text-align: right; color: var(--color-info-text);"><strong>You:</strong> ${message}</div>`;
        chatInput.value = '';
        chatLog.scrollTop = chatLog.scrollHeight;

        setTimeout(() => {
            chatLog.innerHTML += `<div class="chat-message"><strong>Support Bot:</strong> Thank you for your message. An agent will be with you shortly. For urgent issues, please create a ticket.</div>`;
            chatLog.scrollTop = chatLog.scrollHeight;
        }, 1500);
    }


