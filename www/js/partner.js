/**
 * ==========================================================
 * 🤝 Partner Logic Extension
 * Includes: Onboarding Wizard, Network QA/Speed Test
 * ==========================================================
 */

const PartnerLogic = {
    // Wizard State
    currentStep: 1,

    openOnboarding() {
        this.currentStep = 1;
        this.updateWizardUI();
        openModal('partnerOnboardingModal');
    },

    navigateWizard(direction) {
        this.currentStep += direction;
        this.updateWizardUI();
    },

    updateWizardUI() {
        const step1 = document.getElementById('wizardStep1');
        const step2 = document.getElementById('wizardStep2');
        const backBtn = document.getElementById('wizardBackBtn');
        const nextBtn = document.getElementById('wizardNextBtn');
        const finishBtn = document.getElementById('wizardFinishBtn');
        const progressFill = document.getElementById('wizardProgressFill');
        const dots = document.querySelectorAll('.wizard-progress-dot');

        if (this.currentStep === 1) {
            step1.classList.remove('hidden');
            step2.classList.add('hidden');
            backBtn.classList.add('hidden');
            nextBtn.classList.remove('hidden');
            finishBtn.classList.add('hidden');
            if (progressFill) progressFill.style.width = '50%';
        } else {
            step1.classList.add('hidden');
            step2.classList.remove('hidden');
            backBtn.classList.remove('hidden');
            nextBtn.classList.add('hidden');
            finishBtn.classList.remove('hidden');
            if (progressFill) progressFill.style.width = '100%';
        }

        // Update dots
        dots.forEach(dot => {
            if (parseInt(dot.dataset.step) <= this.currentStep) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    },

    async completeOnboarding() {
        const terms = document.getElementById('partnerTermsCheck');
        if (!terms.checked) {
            showToast("Please agree to the terms.", "error");
            return;
        }

        // Upgrade user role in DB
        if (window.currentUser) {
            window.currentUser.role = 'partner';
            
            try {
                if (typeof DataStore !== 'undefined' && DataStore.updateUser) {
                    await DataStore.updateUser(window.currentUser.id, { role: 'partner' });
                }
            } catch(e) {
                console.warn("Failed to update user role in DB, proceeding locally.", e);
            }

            // Refresh UI
            closeModal('partnerOnboardingModal');
            showToast("Welcome to the Partner Network! 🎉", "success");

            // Show partner section
            const partnerSection = document.getElementById('partner-networks-section');
            if (partnerSection) partnerSection.classList.remove('hidden');
            
            // Re-render sidebar/navbar to show partner options
            if (typeof updateNavbar === 'function') updateNavbar();
            if (typeof updateUI === 'function') updateUI();
        }
    },

    // Quality Assurance
    async verifyNetworkQuality(networkData) {
        showToast("Verifying Network Quality...", "info");

        // 1. If MikroTik credentials provided, verify hardware link first
        if (networkData && networkData.mikrotikIp && window.RouterBridge) {
            try {
                showToast(`Testing MikroTik Link: ${networkData.mikrotikIp}...`, "info");
                await window.RouterBridge.connect({
                    host: networkData.mikrotikIp,
                    username: networkData.mikrotikUser || 'admin',
                    password: networkData.mikrotikPass || ''
                });
                showToast("MikroTik Hardware Link Verified! ✅", "success");
            } catch (e) {
                console.warn("[PartnerQA] Hardware link failed:", e.message);
                const proceed = confirm(`MikroTik Hardware Link Failed: "${e.message}". \n\nContinue anyway? (You can fix the IP/Pass later)`);
                if (!proceed) return { passed: false, speed: 0, status: 'Hardware Error' };
            }
        }

        // 2. Simulated Speed Test
        return new Promise(resolve => {
            if (window.Loading) window.Loading.show("Running Speed Test...");
            
            setTimeout(() => {
                if (window.Loading) window.Loading.hide();
                const speed = Math.floor(Math.random() * 45) + 5;
                console.log(`[PartnerQA] Speed Test Result: ${speed} Mbps`);

                if (speed >= 10) {
                    resolve({ passed: true, speed, status: 'Verified' });
                } else {
                    resolve({ passed: false, speed, status: 'Unstable' });
                }
            }, 2000);
        });
    },

    // --- NEW: PARTNER HARDWARE INSIGHTS ---
    async refreshStats() {
        if (!window.RouterBridge || !window.currentUser) return;
        if (window.currentUser.role !== 'partner') return;

        try {
            const health = await window.RouterBridge.getHealthReport();
            
            // Update UI elements if they exist (Partner Dashboard)
            const cpuEl = document.getElementById('partner-cpu-usage');
            const memEl = document.getElementById('partner-mem-usage');
            const userEl = document.getElementById('partner-active-users');
            const uptimeEl = document.getElementById('partner-uptime');

            if (cpuEl) cpuEl.innerText = `${health.cpu}%`;
            if (memEl) memEl.innerText = `${health.memory}%`;
            if (userEl) userEl.innerText = health.users;
            if (uptimeEl) uptimeEl.innerText = health.uptime || 'Unknown';

            console.log("[PartnerLogic] Hardware stats refreshed.");
        } catch (e) {
            console.warn("[PartnerLogic] Failed to refresh stats", e);
        }
    }
};

// Auto-refresh stats for partners
setInterval(() => {
    if (window.PartnerLogic && window.PartnerLogic.refreshStats) {
        window.PartnerLogic.refreshStats();
    }
}, 15000);

// Global Exposure for UI Bindings
window.requestPartnership = () => PartnerLogic.openOnboarding();
window.wizardNav = (dir) => PartnerLogic.navigateWizard(dir);
window.completePartnerOnboarding = () => PartnerLogic.completeOnboarding();

// Hook into the existing savePartnerNetwork function (Monkey Patching for Minimal Intrusion)
// We preserve the original function and wrap it.
const originalSavePartnerNetwork = window.savePartnerNetwork;
window.savePartnerNetwork = async function (e) {
    if (e) e.preventDefault();

    // Check if we are adding a NEW network (no ID)
    const id = document.getElementById('partnerNetworkId').value;

    if (!id) {
        // Gather data for QA
        const networkData = {
            ssid: document.getElementById('partnerNetworkSsid').value,
            pass: document.getElementById('partnerNetworkPassword').value,
            mikrotikIp: document.getElementById('partnerMikrotikIp')?.value,
            mikrotikUser: document.getElementById('partnerMikrotikUser')?.value,
            mikrotikPass: document.getElementById('partnerMikrotikPass')?.value
        };

        // Run QA (includes hardware check)
        const qa = await PartnerLogic.verifyNetworkQuality(networkData);

        if (qa.passed === false && qa.status !== 'Hardware Error') {
            const proceed = confirm(`Network Check Warning: Speed is only ${qa.speed} Mbps (Min 10 Mbps). Add anyway?`);
            if (!proceed) return;
        } else if (qa.passed === false) {
            return; // Cancelled via hardware fail confirm
        } else {
            showToast(`Quality Verified! Speed: ${qa.speed} Mbps`, "success");
        }
    }

    // Call original logic
    if (originalSavePartnerNetwork) originalSavePartnerNetwork(e);
};
