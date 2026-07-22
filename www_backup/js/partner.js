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

        if (this.currentStep === 1) {
            step1.classList.remove('hidden');
            step2.classList.add('hidden');
            backBtn.classList.add('hidden');
            nextBtn.classList.remove('hidden');
            finishBtn.classList.add('hidden');
        } else {
            step1.classList.add('hidden');
            step2.classList.remove('hidden');
            backBtn.classList.remove('hidden');
            nextBtn.classList.add('hidden');
            finishBtn.classList.remove('hidden');
        }
    },

    async completeOnboarding() {
        const terms = document.getElementById('partnerTermsCheck');
        if (!terms.checked) {
            showToast("Please agree to the terms.", "error");
            return;
        }

        // Upgrade user role in DB (Simulated)
        if (window.currentUser) {
            window.currentUser.role = 'partner';
            // In real app: await db.collection('users').doc(currentUser.uid).update({ role: 'partner' });

            // Refresh UI
            closeModal('partnerOnboardingModal');
            showToast("Welcome to the Partner Network! 🎉", "success");

            // Show partner section
            const partnerSection = document.getElementById('partner-networks-section');
            if (partnerSection) partnerSection.classList.remove('hidden'); // Or refresh whole dashboard
            window.location.reload(); // Quick dirty refresh to apply role changes logic
        }
    },

    // Quality Assurance
    async verifyNetworkQuality(networkData) {
        showToast("Verifying Network Quality...", "info");

        // Simulate Speed Test (1-3 seconds)
        return new Promise(resolve => {
            setTimeout(() => {
                // Random speed 5 - 50 Mbps
                const speed = Math.floor(Math.random() * 45) + 5;
                console.log(`[PartnerQA] Speed Test Result: ${speed} Mbps`);

                if (speed >= 10) {
                    resolve({ passed: true, speed, status: 'Verified' });
                } else {
                    resolve({ passed: false, speed, status: 'Unstable' });
                }
            }, 2000);
        });
    }
};

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
        // Run QA first
        const qa = await PartnerLogic.verifyNetworkQuality();

        if (!qa.passed) {
            const proceed = confirm(`Network Check Warning: Speed is only ${qa.speed} Mbps (Min 10 Mbps). Add anyway?`);
            if (!proceed) return;
        } else {
            showToast(`Quality Verified! Speed: ${qa.speed} Mbps`, "success");
        }
    }

    // Call original logic
    if (originalSavePartnerNetwork) originalSavePartnerNetwork(e);
};
