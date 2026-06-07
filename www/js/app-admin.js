/**
 * AgentOS WiFi Manager - Admin Module
 * Version: 2026.5.1
 * Handles Admin dashboard, stats, user management, and voucher generation.
 * Consolidated from legacy app.js logic.
 */

const AppAdmin = {
    // --- Stats & Dashboard ---
    async renderStats() {
        const statsEl = document.getElementById('adminStatsGrid');
        if (!statsEl) return;

        Loading.show('Calculating stats...');
        try {
            const [users, vouchers, txs] = await Promise.all([
                DataStore.getAllUsers(),
                DataStore.getAllVouchers(),
                DataStore.getAllTransactions()
            ]);

            let totalRevenue = txs
                .filter(t => t.type === 'redeem' || t.type === 'purchase')
                .reduce((sum, t) => sum + (t.amount || 0), 0);
            const activeVouchers = vouchers.filter(v => !v.used).length;
            const onlineUsers = users.filter(u => {
                if (!u.lastSeen) return false;
                const ts = u.lastSeen.toDate ? u.lastSeen.toDate() : new Date(u.lastSeen);
                return (Date.now() - ts.getTime()) < 300_000;
            }).length;

            // Attempt to pull live telemetry from gateway stats
            let gwClients = null;
            try {
                const port = window.ENV?.GATEWAY_PORT || '19876';
                const token = window.ENV?.GATEWAY_TOKEN || '';
                const r = await fetch(`http://${location.hostname}:${port}/api/stats`, {
                    headers: { 'x-gateway-token': token },
                    signal: AbortSignal.timeout(3000)
                });
                if (r.ok) {
                    const gw = await r.json();
                    if (gw.vouchers?.revenue) totalRevenue = gw.vouchers.revenue;
                    if (gw.metrics?.clients != null) gwClients = gw.metrics.clients;
                }
            } catch (_) { /* gateway unreachable — use Firestore data */ }

            statsEl.innerHTML = `
                <div class="stat-card">
                    <div class="stat-icon">👥</div>
                    <div class="stat-info"><h3>Total Users</h3><p>${users.length}</p></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💰</div>
                    <div class="stat-info"><h3>Revenue</h3><p>$${totalRevenue.toFixed(2)}</p></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">🎟️</div>
                    <div class="stat-info"><h3>Active Vouchers</h3><p>${activeVouchers}</p></div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">🌐</div>
                    <div class="stat-info"><h3>Online Now</h3>
                    <p>${gwClients != null ? gwClients : onlineUsers}</p></div>
                </div>
            `;

            if (window.Chart) this.renderCharts(txs);
        } catch (e) {
            console.error('[AppAdmin] Stats Error:', e);
        } finally {
            Loading.hide();
        }
    },

    renderCharts(txs) {
        const ctx = document.getElementById('revenueChart');
        if (!ctx) return;

        const dailyData = {};
        txs.forEach(t => {
            const date = (t.timestamp?.toDate ? t.timestamp.toDate() : new Date(t.timestamp || Date.now())).toLocaleDateString();
            dailyData[date] = (dailyData[date] || 0) + (t.amount || 0);
        });

        const labels = Object.keys(dailyData).sort();
        const values = labels.map(l => dailyData[l]);

        if (window._revenueChart) window._revenueChart.destroy();
        window._revenueChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Daily Revenue ($)',
                    data: values,
                    borderColor: '#3a6ef2',
                    backgroundColor: 'rgba(58, 110, 242, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    },

    // --- User Management ---
    async renderUserManagement() {
        const container = document.getElementById('userListContainer');
        if (!container) return;
        container.innerHTML = `<p class="text-medium">Loading users...</p>`;

        try {
            const allUsers = await DataStore.getAllUsers();
            const { data, totalPages } = Pagination.getPageData(allUsers, 'users');

            let html = `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Credits</th><th>Role</th><th></th></tr></thead><tbody>`;
            data.forEach(user => {
                html += `<tr>
                    <td>${user.fullname || 'Unknown'}</td>
                    <td>${user.email || '—'}</td>
                    <td>$${(user.credits || 0).toFixed(2)}</td>
                    <td><span class="badge ${user.role}">${user.role}</span></td>
                    <td style="text-align: right;"><button class="btn btn-sm" onclick="AppAdmin.openAdminUserModal('${user.id}')">Edit</button></td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
            html += Pagination.renderControls('users', totalPages, 'renderUserManagement');
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<p class="text-danger">Error loading users: ${e.message}</p>`;
        }
    },

    async openAdminUserModal(userId) {
        const user = await DataStore.getUser(userId);
        if (!user) return safeShowToast('User not found', 'error');

        const title = document.getElementById('adminUserModalTitle');
        if (title) title.textContent = `Edit User: ${user.fullname}`;

        document.getElementById('adminUserId').value = user.id;
        document.getElementById('adminUserFullname').value = user.fullname || '';
        document.getElementById('adminUserEmail').value = user.email || '';
        document.getElementById('adminUserCredits').value = user.credits || 0;
        document.getElementById('adminUserRole').value = user.role || 'user';

        if (window.openModal) window.openModal('adminUserModal');
    },

    async saveAdminUser(event) {
        if (event) event.preventDefault();
        const userId = document.getElementById('adminUserId').value;
        const data = {
            fullname: document.getElementById('adminUserFullname').value,
            credits: parseFloat(document.getElementById('adminUserCredits').value),
            role: document.getElementById('adminUserRole').value
        };
        try {
            await DataStore.updateUser(userId, data);
            if (window.closeModal) window.closeModal('adminUserModal');
            safeShowToast('User updated successfully!', 'success');
            this.renderUserManagement();
        } catch (e) {
            safeShowToast(`Error updating user: ${e.message}`, 'error');
        }
    },

    // --- Plan Management ---
    async renderPlanManagementAdmin() {
        const container = document.getElementById('planListAdminContainer');
        if (!container) return;
        container.innerHTML = `<p class="text-medium">Loading plans...</p>`;

        try {
            const plans = await DataStore.getPlans();
            let html = `<div class="table-responsive"><table class="admin-table"><thead><tr><th>Image</th><th>Name</th><th>Price</th><th>Duration</th><th>Devices</th><th></th></tr></thead><tbody>`;
            plans.forEach(plan => {
                const imageThumb = plan.imageUrl
                    ? `<img src="${plan.imageUrl}" alt="Plan image" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;">`
                    : `<div style="width: 40px; height: 40px; background: #333; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 10px;">No Img</div>`;

                const duration = `${plan.durationValue || plan.durationDays} ${plan.durationUnit || 'day'}${(plan.durationValue || plan.durationDays) > 1 ? 's' : ''}`;

                html += `<tr>
                    <td>${imageThumb}</td>
                    <td>${plan.name}</td>
                    <td>$${plan.price.toFixed(2)}</td>
                    <td>${duration}</td>
                    <td>${plan.deviceLimit || 1}</td>
                    <td style="text-align: right;"><button class="btn btn-sm" onclick="AppAdmin.openAdminPlanModal('${plan.id}')">Edit</button></td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<p class="text-danger">Error loading plans: ${e.message}</p>`;
        }
    },

    async openAdminPlanModal(planId = null) {
        const form = document.getElementById('adminPlanForm');
        if (form) form.reset();

        const deleteBtn = document.getElementById('deletePlanBtn');
        if (deleteBtn) deleteBtn.classList.add('hidden');

        const preview = document.getElementById('adminPlanImagePreview');
        if (preview) {
            preview.src = '';
            preview.classList.remove('visible');
        }

        const placeholder = document.getElementById('imageUploadPlaceholder');
        if (placeholder) placeholder.style.display = 'block';

        const title = document.getElementById('adminPlanModalTitle');

        if (planId) {
            const plans = await DataStore.getPlans();
            const plan = plans.find(p => p.id === planId);
            if (plan) {
                if (title) title.textContent = `Edit Plan`;
                document.getElementById('adminPlanId').value = plan.id;
                document.getElementById('adminPlanName').value = plan.name;
                document.getElementById('adminPlanDesc').value = plan.description || '';
                document.getElementById('adminPlanPrice').value = plan.price;
                document.getElementById('adminPlanDuration').value = plan.durationValue || plan.durationDays;
                if (plan.durationUnit) document.getElementById('adminPlanDurationUnit').value = plan.durationUnit;

                document.getElementById('adminPlanDevices').value = plan.deviceLimit || 1;
                document.getElementById('adminPlanImageUrl').value = plan.imageUrl || '';
                if (plan.imageUrl && preview) {
                    preview.src = plan.imageUrl;
                    preview.classList.add('visible');
                    if (placeholder) placeholder.style.display = 'none';
                }
                if (deleteBtn) {
                    deleteBtn.classList.remove('hidden');
                    deleteBtn.onclick = () => this.deleteAdminPlan(planId);
                }
            }
        } else {
            if (title) title.textContent = `Add New Plan`;
            document.getElementById('adminPlanId').value = '';
        }

        const uploadBtn = document.getElementById('uploadPlanImageBtn');
        if (uploadBtn) uploadBtn.onclick = () => this.handlePlanImageSelection();

        if (window.openModal) window.openModal('adminPlanModal');
    },

    async handlePlanImageSelection() {
        if (navigator.camera && typeof Camera !== 'undefined') {
            const options = {
                quality: 75,
                destinationType: Camera.DestinationType.DATA_URL,
                sourceType: Camera.PictureSourceType.PHOTOLIBRARY,
                allowEdit: true,
                targetWidth: 600,
                targetHeight: 600
            };
            navigator.camera.getPicture(
                (imageData) => this.uploadImageToFirebase("data:image/jpeg;base64," + imageData),
                (err) => {
                    if (err !== "Selection cancelled." && err !== "No image selected.") {
                        this.triggerBrowserUpload();
                    }
                },
                options
            );
        } else {
            this.triggerBrowserUpload();
        }
    },

    triggerBrowserUpload() {
        const fileInput = document.getElementById('browserFileInput');
        if (!fileInput) return;
        fileInput.value = '';
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => this.uploadImageToFirebase(event.target.result);
            reader.readAsDataURL(file);
        };
        fileInput.click();
    },

    async uploadImageToFirebase(dataUrl) {
        const preview = document.getElementById('adminPlanImagePreview');
        const placeholder = document.getElementById('imageUploadPlaceholder');
        if (preview) {
            preview.src = dataUrl;
            preview.classList.add('visible');
        }
        if (placeholder) placeholder.style.display = 'none';

        Loading.show('Uploading image...');
        try {
            const fileName = `plans/img_${Date.now()}.jpg`;
            const storageRef = firebase.storage().ref().child(fileName);
            const uploadTask = await storageRef.putString(dataUrl, 'data_url');
            const downloadURL = await uploadTask.ref.getDownloadURL();
            document.getElementById('adminPlanImageUrl').value = downloadURL;
            safeShowToast('Image uploaded successfully!', 'success');
        } catch (e) {
            console.error('Upload failed:', e);
            safeShowToast(`Upload failed: ${e.message}`, 'error');
        } finally {
            Loading.hide();
        }
    },

    async saveAdminPlan(event) {
        if (event) event.preventDefault();
        Loading.show('Saving plan...');
        const planId = document.getElementById('adminPlanId').value || null;
        const data = {
            name: document.getElementById('adminPlanName').value,
            description: document.getElementById('adminPlanDesc').value,
            price: parseFloat(document.getElementById('adminPlanPrice').value),
            durationUnit: document.getElementById('adminPlanDurationUnit')?.value || 'days',
            durationValue: parseInt(document.getElementById('adminPlanDuration').value),
            deviceLimit: parseInt(document.getElementById('adminPlanDevices').value),
            imageUrl: document.getElementById('adminPlanImageUrl').value.trim()
        };
        try {
            await DataStore.savePlan(planId, data);
            Loading.hide();
            if (window.closeModal) window.closeModal('adminPlanModal');
            safeShowToast('Plan saved successfully!', 'success');
            this.renderPlanManagementAdmin();
            if (window.updatePlans) window.updatePlans(); // Refresh client view
        } catch (e) {
            Loading.hide();
            safeShowToast(`Error: ${e.message}`, 'error');
        }
    },

    async deleteAdminPlan(planId) {
        if (!confirm('Are you sure you want to delete this plan?')) return;
        try {
            await DataStore.deletePlan(planId);
            if (window.closeModal) window.closeModal('adminPlanModal');
            safeShowToast('Plan deleted successfully', 'success');
            this.renderPlanManagementAdmin();
            if (window.updatePlans) window.updatePlans();
        } catch (e) {
            safeShowToast(`Error deleting plan: ${e.message}`, 'error');
        }
    },

    // --- Voucher Management ---
    async renderVoucherList() {
        const container = document.getElementById('voucherListContainer');
        if (!container) return;
        container.innerHTML = `<p class="text-medium">Loading vouchers...</p>`;

        try {
            const allVouchers = await DataStore.getAllVouchers();
            const { data, totalPages } = Pagination.getPageData(allVouchers, 'vouchers');

            let html = `
                <div class="bulk-actions-bar" style="margin-bottom: 15px; display: flex; gap: 10px; align-items: center;">
                    <button class="btn btn-secondary btn-sm" onclick="AppAdmin.bulkPrintVouchers()">Bulk Print Selected</button>
                    <span class="text-medium" id="selectedCountDisplay">0 selected</span>
                </div>
                <div class="table-responsive"><table class="admin-table">
                <thead>
                    <tr>
                        <th style="width: 40px;"><input type="checkbox" id="selectAllVouchers" onclick="AppAdmin.toggleAllVouchers(this)"></th>
                        <th>Code</th>
                        <th>Value</th>
                        <th>Status</th>
                        <th>Used By</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>`;

            data.forEach(v => {
                const isExpired = v.expiresAt && (v.expiresAt.seconds ? v.expiresAt.seconds * 1000 : new Date(v.expiresAt)) < Date.now();
                let status, actions;

                if (v.used) {
                    status = `<span class="status-badge expired">Used</span>`;
                    actions = '';
                } else if (isExpired) {
                    status = `<span class="status-badge warning">Expired</span>`;
                    actions = `<button class="btn btn-sm btn-danger" onclick="AppAdmin.deleteVoucher('${v.id}')">Delete</button>`;
                } else {
                    status = `<span class="status-badge active">Active</span>`;
                    actions = `
                        <div class="btn-group">
                            <button class="btn btn-sm btn-info" onclick="AppAdmin.openSendVoucherModal('${v.id}', '${v.code}', ${v.value})">Send</button>
                            <button class="btn btn-sm btn-secondary" onclick="AppAdmin.printSingleVoucher('${v.code}')">Print</button>
                            <button class="btn btn-sm btn-danger" onclick="AppAdmin.deleteVoucher('${v.id}')">Delete</button>
                        </div>`;
                }

                const usedBy = v.used && v.redeemedByUsername ? v.redeemedByUsername : '—';
                const profile = v.profile || `$${(v.value || 0).toFixed(2)} Credit`;

                html += `
                    <tr>
                        <td><input type="checkbox" class="voucher-checkbox" 
                            data-id="${v.id}" 
                            data-code="${v.code}" 
                            data-value="${v.value}" 
                            data-profile="${profile}"
                            data-password="${v.password || v.code}"
                            onchange="AppAdmin.updateSelectedCount()"></td>
                        <td><strong>${v.code}</strong></td>
                        <td>$${(v.value || 0).toFixed(2)}</td>
                        <td>${status}</td>
                        <td class="text-medium">${usedBy}</td>
                        <td style="text-align:right;">${actions}</td>
                    </tr>`;
            });
            html += `</tbody></table></div>`;
            html += Pagination.renderControls('vouchers', totalPages, 'renderVoucherList');
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<p class="text-danger">Error: ${e.message}</p>`;
        }
    },

    toggleAllVouchers(master) {
        const checkboxes = document.querySelectorAll('.voucher-checkbox');
        checkboxes.forEach(cb => cb.checked = master.checked);
        this.updateSelectedCount();
    },

    updateSelectedCount() {
        const selected = document.querySelectorAll('.voucher-checkbox:checked');
        const display = document.getElementById('selectedCountDisplay');
        if (display) display.textContent = `${selected.length} selected`;
    },

    async openGenerateVoucherModal() {
        const form = document.getElementById('generateVoucherForm');
        if (form) form.reset();

        await this.refreshPrinters();

        if (window.openModal) window.openModal('generateVoucherModal');
    },

    async generateVouchers(event) {
        if (event) event.preventDefault();
        const value = parseFloat(document.getElementById('voucherValue').value);
        const quantity = parseInt(document.getElementById('voucherQuantity').value);
        const iface = document.getElementById('voucherPrinterInterface').value;

        Loading.show(`Generating ${quantity} vouchers...`);
        try {
            const codes = [];
            for (let i = 0; i < quantity; i++) {
                const code = 'STAR-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                await DataStore.vouchers.add({
                    code,
                    value,
                    used: false,
                    status: 'active',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                codes.push(code);
            }

            if (iface !== 'none') {
                for (let i = 0; i < codes.length; i++) {
                    Loading.show(`Printing ${i + 1}/${codes.length}...`);
                    if (iface.startsWith('cordova_bt:')) {
                        await this.printCordovaVoucher(iface.split('cordova_bt:')[1], codes[i], codes[i], `$${value.toFixed(2)} Credit`).catch(e => console.warn('BT Print failed', e));
                    } else if (iface.startsWith('web_usb:')) {
                        await this.printWebUSB(iface, codes[i], codes[i], `$${value.toFixed(2)} Credit`).catch(e => console.warn('USB Print failed', e));
                    } else if (typeof BackendBridge !== 'undefined') {
                        await BackendBridge.executeTool('agentos.voucher.print', {
                            voucher: {
                                username: codes[i],
                                password: codes[i],
                                profile: `$${value.toFixed(2)} Credit`,
                                loginUrl: `http://hotspot.local/redeem?code=${codes[i]}`
                            },
                            interface: iface === 'PRINTER_MAIN' ? undefined : iface
                        }).catch(e => console.warn('Print failed', e));
                    }
                }
            }

            Loading.hide();
            if (window.closeModal) window.closeModal('generateVoucherModal');
            safeShowToast(`${quantity} vouchers generated!`, 'success');
            this.renderVoucherList();
        } catch (e) {
            Loading.hide();
            safeShowToast('Error: ' + e.message, 'error');
        }
    },

    async bulkPrintVouchers() {
        const selected = document.querySelectorAll('.voucher-checkbox:checked');
        if (selected.length === 0) return safeShowToast('Select vouchers first', 'warning');

        const ifaceSelect = document.getElementById('bulkPrintInterface');
        if (ifaceSelect) {
            await this.refreshPrinters();
        }

        const countLabel = document.getElementById('bulkPrintCountLabel');
        if (countLabel) countLabel.textContent = `${selected.length} vouchers selected.`;

        if (window.openModal) window.openModal('bulkPrintModal');
    },

    async confirmBulkPrint() {
        const selected = document.querySelectorAll('.voucher-checkbox:checked');
        let iface = document.getElementById('bulkPrintInterface')?.value;
        if (window.closeModal) window.closeModal('bulkPrintModal');
        
        if (iface === 'manual_bt') {
            const mac = prompt('Enter Printer Bluetooth MAC Address (e.g. 00:11:22:33:44:55):');
            if (!mac) return;
            iface = 'cordova_bt:' + mac;
        }

        Loading.show(`Printing ${selected.length} vouchers...`);
        for (let i = 0; i < selected.length; i++) {
            const el = selected[i];
            Loading.show(`Printing ${i + 1}/${selected.length}: ${el.dataset.code}`);
            if (iface && iface.startsWith('cordova_bt:')) {
                await this.printCordovaVoucher(iface.split('cordova_bt:')[1], el.dataset.code, el.dataset.password || el.dataset.code, el.dataset.profile).catch(e => console.warn('BT Print failed', e));
            } else if (iface && iface.startsWith('web_usb:')) {
                await this.printWebUSB(iface, el.dataset.code, el.dataset.password || el.dataset.code, el.dataset.profile).catch(e => console.warn('USB Print failed', e));
            } else if (typeof BackendBridge !== 'undefined') {
                await BackendBridge.executeTool('agentos.voucher.print', {
                    voucher: {
                        username: el.dataset.code,
                        password: el.dataset.password || el.dataset.code,
                        profile: el.dataset.profile,
                        loginUrl: `http://hotspot.local/redeem?code=${el.dataset.code}`
                    },
                    interface: iface || undefined
                }).catch(e => console.warn('Print failed', e));
            }
        }
        Loading.hide();
        safeShowToast('Bulk print finished', 'info');
    },

    async printSingleVoucher(code) {
        const v = await DataStore.getVoucherByCode(code);
        if (!v) return safeShowToast('Voucher not found', 'error');

        const select = document.getElementById('voucherPrinterInterface');
        let iface = select ? select.value : '';

        if (iface === 'manual_bt') {
            const mac = prompt('Enter Printer Bluetooth MAC Address (e.g. 00:11:22:33:44:55):');
            if (!mac) return;
            iface = 'cordova_bt:' + mac;
        }

        Loading.show(`Printing ${code}...`);
        try {
            if (iface && iface.startsWith('cordova_bt:')) {
                await this.printCordovaVoucher(iface.split('cordova_bt:')[1], v.code, v.password || v.code, v.profile || `$${(v.value || 0).toFixed(2)} Credit`);
                safeShowToast('Print job sent via Bluetooth', 'success');
            } else if (iface && iface.startsWith('web_usb:')) {
                await this.printWebUSB(iface, v.code, v.password || v.code, v.profile || `$${(v.value || 0).toFixed(2)} Credit`);
                safeShowToast('Print job sent via WebUSB', 'success');
            } else if (typeof BackendBridge !== 'undefined') {
                await BackendBridge.executeTool('agentos.voucher.print', {
                    voucher: {
                        username: v.code,
                        password: v.password || v.code,
                        profile: v.profile || `$${(v.value || 0).toFixed(2)} Credit`,
                        loginUrl: `http://hotspot.local/redeem?code=${v.code}`
                    }
                });
                safeShowToast('Print job sent', 'success');
            } else {
                throw new Error('BackendBridge not available');
            }
        } catch (e) {
            safeShowToast('Print failed: ' + e.message, 'error');
        } finally {
            Loading.hide();
        }
    },

    async deleteVoucher(id) {
        if (!confirm('Delete this voucher?')) return;
        try {
            await DataStore.vouchers.doc(id).delete();
            safeShowToast('Voucher deleted', 'success');
            this.renderVoucherList();
        } catch (e) { safeShowToast('Error: ' + e.message, 'error'); }
    },

    async openSendVoucherModal(id, code, value) {
        const modal = document.getElementById('sendVoucherModal');
        if (!modal) return;
        modal.dataset.voucherId = id;
        modal.dataset.voucherCode = code;
        modal.dataset.voucherValue = value;

        const select = document.getElementById('voucherRecipient');
        select.innerHTML = '<option>Loading...</option>';
        const users = await DataStore.getAllUsers();
        select.innerHTML = users.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}">${u.fullname || u.username}</option>`).join('');

        if (window.openModal) window.openModal('sendVoucherModal');
    },

    async sendVoucherToUser(event) {
        if (event) event.preventDefault();
        const modal = document.getElementById('sendVoucherModal');
        const recipientId = document.getElementById('voucherRecipient').value;
        const { voucherId, voucherCode, voucherValue } = modal.dataset;

        if (!recipientId) return safeShowToast('Select a recipient', 'error');

        Loading.show('Sending voucher...');
        try {
            // Use db directly (getFirestore() is not defined in browser context)
            const batch = db.batch();
            batch.update(DataStore.vouchers.doc(voucherId), {
                used: true,
                usedBy: recipientId,
                redeemedByUsername: 'Admin Gift',
                usedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            batch.update(DataStore.users.doc(recipientId), {
                credits: firebase.firestore.FieldValue.increment(parseFloat(voucherValue || 0))
            });
            await batch.commit();

            safeShowToast('Voucher sent!', 'success');
            if (window.closeModal) window.closeModal('sendVoucherModal');
            this.renderVoucherList();
        } catch (e) {
            safeShowToast('Error: ' + e.message, 'error');
        } finally {
            Loading.hide();
        }
    },

    // ── Session Management via Gateway ────────────────────────────────────────

    /**
     * Kick an active hotspot session without disabling the account.
     * @param {string} username  MikroTik hotspot username (usually the voucher code)
     */
    async kickUserSession(username) {
        if (!username) return safeShowToast('Username required', 'error');
        Loading.show(`Kicking session: ${username}…`);
        try {
            const port = window.ENV?.GATEWAY_PORT || '19876';
            const token = window.ENV?.GATEWAY_TOKEN || '';
            const r = await fetch(`http://${location.hostname}:${port}/api/v1/users/kick`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-gateway-token': token },
                body: JSON.stringify({ user: username }),
                signal: AbortSignal.timeout(6000)
            });
            const json = await r.json();
            if (json.ok) {
                safeShowToast(`Session kicked: ${username}`, 'success');
            } else {
                safeShowToast(`Kick failed: ${json.error || 'unknown'}`, 'warning');
            }
        } catch (e) {
            safeShowToast(`Gateway unreachable: ${e.message}`, 'error');
        } finally {
            Loading.hide();
        }
    },

    /**
     * Revoke a voucher: mark it in Firestore and kick any active session.
     * @param {string} voucherId  Firestore document ID
     * @param {string} code       Voucher code (=MikroTik username)
     */
    async revokeVoucher(voucherId, code) {
        if (!confirm(`Revoke voucher ${code}? The active session will be terminated.`)) return;
        Loading.show(`Revoking ${code}…`);
        try {
            // Mark in Firestore
            await DataStore.vouchers.doc(voucherId).update({
                status: 'revoked',
                revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
                revokedBy: window.currentUser?.uid || 'admin'
            });

            // Kick the hotspot session (non-fatal)
            await this.kickUserSession(code).catch(() => { });

            safeShowToast(`Voucher ${code} revoked`, 'success');
            this.renderVoucherList();
        } catch (e) {
            safeShowToast('Revoke failed: ' + e.message, 'error');
        } finally {
            Loading.hide();
        }
    },

    // --- Network Settings ---
    async renderNetworkSettings() {
        const display = document.getElementById('networkSettingsDisplay');
        if (!display) return;

        try {
            const network = await DataStore.getNetworkSettings();
            display.innerHTML = `
                <div class="network-info">
                    <p><strong>SSID:</strong> ${network.ssid}</p>
                    <p><strong>Password:</strong> •••••••• <button class="btn btn-sm" onclick="AppAdmin.revealPassword(event, '${network.password}')">Show</button></p>
                </div>
            `;
            document.getElementById('adminNetworkSsid').value = network.ssid;
            document.getElementById('adminNetworkPassword').value = network.password;
        } catch (e) { console.error('Network load error', e); }
    },

    revealPassword(event, pwd) {
        const btn = event.target;
        const p = btn.previousSibling;
        if (btn.textContent === 'Show') {
            btn.previousSibling.textContent = pwd + ' ';
            btn.textContent = 'Hide';
        } else {
            btn.previousSibling.textContent = '•••••••• ';
            btn.textContent = 'Show';
        }
    },

    async saveNetworkSettings(event) {
        if (event) event.preventDefault();
        const data = {
            ssid: document.getElementById('adminNetworkSsid').value,
            password: document.getElementById('adminNetworkPassword').value
        };
        try {
            await DataStore.updateNetworkSettings(data);
            if (window.closeModal) window.closeModal('adminNetworkModal');
            safeShowToast('Settings updated', 'success');
            this.renderNetworkSettings();
        } catch (e) { safeShowToast('Error: ' + e.message, 'error'); }
    },

    // --- Message Management ---
    async renderMessagesSection() {
        const container = document.getElementById('adminMessageList');
        if (!container) return;

        const tickets = await DataStore.getTickets();
        const { data, totalPages } = Pagination.getPageData(tickets, 'message');

        container.innerHTML = data.map(ticket => `
            <div class="message-card ${ticket.status === 'Open' ? 'unread' : ''}" onclick="AppAdmin.openTicketDetail('${ticket.id}')">
                <div class="msg-header">
                    <strong>${ticket.subject}</strong>
                    <span class="status-badge ${ticket.status.toLowerCase()}">${ticket.status}</span>
                </div>
                <div class="msg-meta">${ticket.userEmail || 'User'} • ${ticket.createdAt?.toDate ? ticket.createdAt.toDate().toLocaleString() : 'N/A'}</div>
            </div>
        `).join('') + Pagination.renderControls('message', totalPages, 'renderMessagesSection');
    },

    async openTicketDetail(id) {
        const ticket = await DataStore.tickets.doc(id).get();
        if (!ticket.exists) return;
        const data = ticket.data();

        const content = document.getElementById('adminTicketContent');
        if (!content) return;

        content.innerHTML = `
            <h3>${data.subject}</h3>
            <p class="meta">From: ${data.userEmail} | ${data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString() : 'N/A'}</p>
            <div class="ticket-body" style="margin: 20px 0; padding: 15px; background: rgba(255,255,255,0.05); border-radius: 8px;">${data.body}</div>
            <div class="ticket-actions" style="display: flex; gap: 10px;">
                <button class="btn btn-primary" onclick="AppAdmin.closeTicket('${id}')">Resolve Ticket</button>
                <button class="btn btn-outline" onclick="if(window.closeModal) window.closeModal('adminTicketModal')">Close</button>
            </div>
        `;
        if (window.openModal) window.openModal('adminTicketModal');
    },

    async closeTicket(id) {
        try {
            await DataStore.tickets.doc(id).update({ status: 'Resolved' });
            safeShowToast('Ticket resolved', 'success');
            if (window.closeModal) window.closeModal('adminTicketModal');
            this.renderMessagesSection();
        } catch (e) { safeShowToast('Error', 'error'); }
    },

    // --- Cordova Printer Methods ---
    async refreshPrinters() {
        const select = document.getElementById('voucherPrinterInterface');
        const bulkSelect = document.getElementById('bulkPrintInterface');
        const globalSelect = document.getElementById('globalPrinterInterface');
        const statusLabel = document.getElementById('printerInterfaceLabel');

        if (statusLabel) statusLabel.textContent = 'Interface: Discovering...';

        let options = '<option value="none">No Print</option>';
        let deviceCount = 0;

        // 1. Native Cordova Bluetooth Serial
        if (typeof bluetoothSerial !== 'undefined') {
            try {
                const btDevices = await new Promise((resolve) => {
                    bluetoothSerial.list(resolve, (err) => resolve([]));
                });
                btDevices.forEach(dev => {
                    options += `<option value="cordova_bt:${dev.address}">BT: ${dev.name || dev.address}</option>`;
                    deviceCount++;
                });
            } catch (e) {
                console.warn('BT list error', e);
            }
        }

        // 2. WebUSB
        if (typeof navigator !== 'undefined' && navigator.usb) {
            try {
                const devices = await navigator.usb.getDevices();
                devices.forEach(dev => {
                    options += `<option value="web_usb:${dev.vendorId}:${dev.productId}">USB: ${dev.productName || 'Thermal Printer'}</option>`;
                    deviceCount++;
                });
                options += '<option value="web_usb:request">➕ Request USB Printer</option>';
            } catch (err) {
                console.warn('USB list failed', err);
            }
        }

        // 3. BackendBridge (Legacy Node.js Daemon)
        if (typeof BackendBridge !== 'undefined') {
            try {
                const result = await BackendBridge.executeTool('agentos.printer.list');
                if (result?.interfaces) {
                    result.interfaces.forEach(iface => {
                        options += `<option value="${iface.id}">${iface.status === 'online' ? '🟢' : '🔴'} ${iface.name}</option>`;
                        deviceCount++;
                    });
                }
            } catch (err) {
                console.warn('Backend printer list failed', err);
            }
        }

        // 4. Manual Add MAC
        options += '<option value="manual_bt">➕ Enter Bluetooth MAC</option>';

        if (select) select.innerHTML = options;
        if (bulkSelect) bulkSelect.innerHTML = options;
        if (globalSelect) globalSelect.innerHTML = options;
        if (statusLabel) statusLabel.textContent = `Interface: Found ${deviceCount} devices`;
    },

    async testPrinter() {
        const select = document.getElementById('globalPrinterInterface') || document.getElementById('voucherPrinterInterface');
        let iface = select ? select.value : 'none';

        if (iface === 'manual_bt') {
            const mac = prompt('Enter Printer Bluetooth MAC Address (e.g. 00:11:22:33:44:55):');
            if (!mac) return;
            iface = 'cordova_bt:' + mac;
        }

        if (iface === 'none') {
            safeShowToast('No printer interface selected', 'warning');
            return;
        }

        if (iface.startsWith('cordova_bt:')) {
            const mac = iface.split('cordova_bt:')[1];
            Loading.show('Connecting to BT Printer...');
            bluetoothSerial.connect(mac, () => {
                Loading.show('Printing Test Page...');
                const text = "AgentOS Thermal Printer Test Page\n" + new Date().toLocaleString() + "\n\n\n";
                bluetoothSerial.write(text, () => {
                    bluetoothSerial.disconnect();
                    Loading.hide();
                    safeShowToast('Test page printed!', 'success');
                }, (err) => {
                    bluetoothSerial.disconnect();
                    Loading.hide();
                    safeShowToast('Write failed: ' + err, 'error');
                });
            }, (err) => {
                Loading.hide();
                safeShowToast('Connect failed: ' + err, 'error');
            });
            return;
        }

        if (iface.startsWith('web_usb:')) {
            Loading.show('Sending test print to USB...');
            try {
                const ESC = "\x1B";
                const text = ESC + "\x40" + "AgentOS USB Test Page\n" + new Date().toLocaleString() + "\n\n\n";
                await this.printWebUSBData(iface, text);
                safeShowToast('Test job sent via WebUSB', 'success');
            } catch (e) {
                safeShowToast('USB Print failed: ' + e.message, 'error');
            } finally {
                Loading.hide();
            }
            return;
        }

        Loading.show('Sending test print...');
        try {
            if (typeof BackendBridge !== 'undefined') {
                await BackendBridge.executeTool('agentos.printer.test', { text: "Manual UI Test Print" });
                safeShowToast('Test job sent', 'success');
            } else {
                safeShowToast('BackendBridge not available', 'error');
            }
        } catch (e) {
            safeShowToast('Test print failed', 'error');
        } finally {
            Loading.hide();
        }
    },

    printCordovaVoucher(mac, code, password, profile) {
        return new Promise((resolve, reject) => {
            if (typeof bluetoothSerial === 'undefined') return reject(new Error('Bluetooth not available'));
            bluetoothSerial.connect(mac, () => {
                const ESC = "\x1B";
                const text =
                    ESC + "\x40" + // Init
                    ESC + "\x61\x01" + // Center align
                    "POWER CONNECT HOTSPOT\n" +
                    "================================\n" +
                    "Voucher Code:\n" +
                    ESC + "\x21\x30" + // Double height/width
                    code + "\n" +
                    ESC + "\x21\x00" + // Normal
                    "================================\n" +
                    "Profile: " + profile + "\n" +
                    "Time: " + new Date().toLocaleString() + "\n\n\n\n";

                bluetoothSerial.write(text, () => {
                    bluetoothSerial.disconnect();
                    resolve();
                }, (err) => {
                    bluetoothSerial.disconnect();
                    reject(new Error(err));
                });
            }, (err) => {
                reject(new Error(err));
            });
        });
    },

    async printWebUSB(iface, code, password, profile) {
        const ESC = "\x1B";
        const text =
            ESC + "\x40" + // Init
            ESC + "\x61\x01" + // Center align
            "POWER CONNECT HOTSPOT\n" +
            "================================\n" +
            "Voucher Code:\n" +
            ESC + "\x21\x30" + // Double height/width
            code + "\n" +
            ESC + "\x21\x00" + // Normal
            "================================\n" +
            "Profile: " + profile + "\n" +
            "Time: " + new Date().toLocaleString() + "\n\n\n\n";
        return this.printWebUSBData(iface, text);
    },

    async printWebUSBData(iface, text) {
        if (!navigator.usb) throw new Error('WebUSB not supported in this browser');
        
        let device = null;
        if (iface === 'web_usb:request') {
            device = await navigator.usb.requestDevice({ filters: [] });
        } else {
            const parts = iface.split(':');
            const vid = parseInt(parts[1]);
            const pid = parseInt(parts[2]);
            const devices = await navigator.usb.getDevices();
            device = devices.find(d => d.vendorId === vid && d.productId === pid);
            if (!device) device = await navigator.usb.requestDevice({ filters: [{ vendorId: vid, productId: pid }] });
        }

        if (!device) throw new Error('USB Printer not selected');

        await device.open();
        if (device.configuration === null) await device.selectConfiguration(1);
        await device.claimInterface(0);

        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        
        let outEndpoint = null;
        for (const ep of device.configuration.interfaces[0].alternate.endpoints) {
            if (ep.direction === 'out') {
                outEndpoint = ep.endpointNumber;
                break;
            }
        }
        if (outEndpoint === null) throw new Error('No bulk out endpoint found on USB printer');

        await device.transferOut(outEndpoint, data);
        await device.close();
    }
};

// Export to window
window.AppAdmin = AppAdmin;

// Compatibility aliases for legacy calls
window.renderUserManagement = () => AppAdmin.renderUserManagement();
window.renderPlanManagementAdmin = () => AppAdmin.renderPlanManagementAdmin();
window.renderVoucherList = () => AppAdmin.renderVoucherList();
window.renderNetworkSettings = () => AppAdmin.renderNetworkSettings();
window.openAdminUserModal = (id) => AppAdmin.openAdminUserModal(id);
window.saveAdminUser = (e) => AppAdmin.saveAdminUser(e);
window.openAdminPlanModal = (id) => AppAdmin.openAdminPlanModal(id);
window.saveAdminPlan = (e) => AppAdmin.saveAdminPlan(e);
window.openGenerateVoucherModal = () => AppAdmin.openGenerateVoucherModal();
window.generateVouchers = (e) => AppAdmin.generateVouchers(e);
window.bulkPrintVouchers = () => AppAdmin.bulkPrintVouchers();
window.confirmBulkPrint = () => AppAdmin.confirmBulkPrint();
window.openSendVoucherModal = (id, c, v) => AppAdmin.openSendVoucherModal(id, c, v);
window.sendVoucherToUser = (e) => AppAdmin.sendVoucherToUser(e);
window.saveNetworkSettings = (e) => AppAdmin.saveNetworkSettings(e);
window.openEditNetworkModal = () => window.openModal('adminNetworkModal');
window.testPrinter = () => AppAdmin.testPrinter();
window.refreshPrinters = () => AppAdmin.refreshPrinters();
window.kickUserSession = (u) => AppAdmin.kickUserSession(u);
window.revokeVoucher = (id, c) => AppAdmin.revokeVoucher(id, c);
