/* ==========================================================
   01.ui.utils.js — Loading spinner, Toast, Pagination
   Depends on: nothing
   ========================================================== */

// ── Loading Spinner ─────────────────────────────────────────
window.Loading = {
    show(msg = 'Please wait...') {
        const el  = document.getElementById('loadingOverlay');
        const txt = document.getElementById('loadingText');
        if (el) {
            if (txt) txt.textContent = msg;
            el.style.display = 'flex';
        }
    },
    hide() {
        const el = document.getElementById('loadingOverlay');
        if (el) el.style.display = 'none';
    }
};

// ── Toast Notification ──────────────────────────────────────
let _toastTimeout;
window.showToast = function (message, type = 'info') {
    const toast  = document.getElementById('toast');
    const iconEl = document.getElementById('toastIcon');
    const msgEl  = document.getElementById('toastMessage');

    if (!toast || !msgEl) { console.log(`[Toast-${type}] ${message}`); return; }

    const icons  = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const colors = {
        success: 'var(--color-success)',
        error:   'var(--color-danger)',
        info:    'var(--color-info)',
        warning: '#ffaa00'
    };

    toast.style.backgroundColor = colors[type] || colors.info;
    if (iconEl) iconEl.textContent = icons[type] || icons.info;
    msgEl.textContent = message;

    toast.classList.remove('hidden');
    if (_toastTimeout) clearTimeout(_toastTimeout);
    _toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3000);
};

// ── Pagination ──────────────────────────────────────────────
window.Pagination = {
    state:    { users: 1, vouchers: 1, transactions: 1, tickets: 1 },
    pageSize: 10,

    getPageData(data, context) {
        if (!data || !Array.isArray(data)) return { data: [], totalPages: 1 };
        if (!this.state[context]) this.state[context] = 1;

        const totalPages = Math.ceil(data.length / this.pageSize) || 1;
        if (this.state[context] > totalPages) this.state[context] = totalPages;
        if (this.state[context] < 1)          this.state[context] = 1;

        const start = (this.state[context] - 1) * this.pageSize;
        return { data: data.slice(start, start + this.pageSize), totalPages, currentPage: this.state[context] };
    },

    renderControls(context, totalPages, callbackName) {
        if (totalPages <= 1) return '';
        const cur = this.state[context];
        return `
            <div class="pagination-controls">
                <button class="btn btn-sm" ${cur === 1 ? 'disabled' : ''}
                    onclick="Pagination.changePage('${context}',-1,'${callbackName}')">Prev</button>
                <span class="page-info"> ${cur} / ${totalPages} </span>
                <button class="btn btn-sm" ${cur === totalPages ? 'disabled' : ''}
                    onclick="Pagination.changePage('${context}',1,'${callbackName}')">Next</button>
            </div>`;
    },

    changePage(context, dir, callbackName) {
        this.state[context] += dir;
        if (typeof window[callbackName] === 'function') window[callbackName]();
    }
};
