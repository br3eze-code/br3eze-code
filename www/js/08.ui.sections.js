/* ==========================================================
   08.ui.sections.js — Navbar, dashboard, section routing,
                       plan countdown timer
   Depends on: 01.ui.utils.js, 06.firebase.js
   ========================================================== */

let _timerInterval = null;

// ── Section router ──────────────────────────────────────────
window.showSection = function (id) {
    document.querySelectorAll('.dashboard-section').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));

    const section = document.getElementById(id + '-section');
    if (section) section.classList.remove('hidden');

    const nav = document.querySelector(`.sidebar li[data-section="${id}"]`);
    if (nav) nav.classList.add('active');

    // Section-specific loaders
    if (id === 'subscriptions') renderPlans();
    if (id === 'messages')      renderMessages();
};

// ── Navbar ──────────────────────────────────────────────────
function updateNavbar() {
    const u = window.currentUser;
    document.getElementById('navUsername').textContent      = u.fullname;
    document.getElementById('navUsernameShort').textContent = u.fullname.charAt(0).toUpperCase();
    document.getElementById('dropdownFullname').textContent = u.fullname;
    document.getElementById('dropdownEmail').textContent    = u.email;
}

// ── Dashboard stat tiles ────────────────────────────────────
function updateDashboard() {
    const u          = window.currentUser;
    const activeSubs = (u.subscriptions || []).filter(s => s.expiresAt?.seconds * 1000 > Date.now());
    document.getElementById('dashCredits').textContent = (u.credits || 0).toFixed(2);
    document.getElementById('dashPlans').textContent   = activeSubs.length;
}

// ── Plan countdown timer ────────────────────────────────────
function checkPlanStatus() {
    const u   = window.currentUser;
    const sub = (u.subscriptions || []).find(s => s.expiresAt?.seconds * 1000 > Date.now());

    if (_timerInterval) clearInterval(_timerInterval);

    // Bypass for Admins & Family
    if (u.role === 'admin' || u.role === 'family') {
        document.getElementById('dashUptime').innerHTML = '<span style="color:var(--success)">∞ Unlimited (Bypass)</span>';
        document.getElementById('planProgressBar').style.width = '100%';
        document.getElementById('planStartLabel').textContent = 'Admin/Family';
        document.getElementById('planEndLabel').textContent   = 'Never expires';
        return;
    }

    if (!sub) {
        document.getElementById('dashUptime').innerHTML = '<span style="color:red">Inactive</span>';
        document.getElementById('planProgressBar').style.width = '0%';
        document.getElementById('planStartLabel').textContent = '--';
        document.getElementById('planEndLabel').textContent   = '--';
        return;
    }

    const fmt = ts => new Date(ts * 1000).toLocaleDateString();
    document.getElementById('planStartLabel').textContent = fmt(sub.purchasedAt.seconds);
    document.getElementById('planEndLabel').textContent   = fmt(sub.expiresAt.seconds);

    // Provide a mocked plan object for AIBridge containing standard JS dates
    const planObjForAI = {
        expiresAt: { toMillis: () => sub.expiresAt.seconds * 1000 },
        _notified5Min: sub._notified5Min || false
    };

    _timerInterval = setInterval(() => {
        const now   = Date.now();
        const end   = sub.expiresAt.seconds * 1000;
        const start = sub.purchasedAt.seconds * 1000;
        const left  = end - now;

        if (left <= 0) {
            clearInterval(_timerInterval);
            document.getElementById('dashUptime').innerHTML = '<span style="color:red">Expired</span>';
            document.getElementById('planProgressBar').style.width = '100%';
            return;
        }

        const pct = Math.min(((now - start) / (end - start)) * 100, 100);
        document.getElementById('planProgressBar').style.width = pct + '%';

        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        document.getElementById('dashUptime').textContent = `${h}h ${m}m remaining`;

        // AI Hooks
        if (window.AIBridge) {
            window.AIBridge.analyzeUsage(planObjForAI);
            window.AIBridge.checkPlanHealth(planObjForAI);
            sub._notified5Min = planObjForAI._notified5Min; // sync state back
        }
    }, 1000);
}

// ── Dropdown toggle ─────────────────────────────────────────
window.toggleDropdown = function (id) {
    const el = document.getElementById(id);
    if (el) el.style.display = el.style.display === 'block' ? 'none' : 'block';
};

// ── Auth form toggle ────────────────────────────────────────
window.toggleAuthForm = function () {
    document.getElementById('loginForm').classList.toggle('hidden');
    document.getElementById('signupForm').classList.toggle('hidden');
};

// ── Forgot password toggle (login <-> reset-request) ────────
window.toggleForgotPassword = function () {
    document.getElementById('loginForm').classList.toggle('hidden');
    document.getElementById('forgotPasswordForm').classList.toggle('hidden');
};

// ── Main app init (called after auth) ──────────────────────
async function initApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display    = 'flex';
    document.getElementById('mainHeader').style.display = 'flex';

    if (window.currentUser.role === 'admin') {
        document.getElementById('adminToolsLink')?.classList.remove('hidden');
        document.getElementById('admin-stats-section')?.classList.remove('hidden');
    }

    updateNavbar();
    updateDashboard();
    checkPlanStatus();

    if (window.NetworkTools) window.NetworkTools.initialize();

    Loading.hide();
}
