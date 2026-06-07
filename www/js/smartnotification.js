/**
 * SmartNotification Module
 * Handles custom in-app notifications and alerts.
 */

const SmartNotification = {
    toastTimeout: null,

    show(title, message, type = 'info', options = {}) {
        const toast = document.getElementById('toast');
        const iconEl = document.getElementById('toastIcon');
        const msgEl = document.getElementById('toastMessage');
        
        if (!toast || !iconEl || !msgEl) return;

        // Reset
        clearTimeout(this.toastTimeout);
        msgEl.innerHTML = '';
        toast.classList.remove('hidden');
        
        // Style by type
        toast.style.backgroundColor = this.getColorForType(type);
        toast.style.color = 'var(--color-text-light)';
        
        iconEl.textContent = this.getIconForType(type);
        
        // Text Content
        const textSpan = document.createElement('span');
        textSpan.textContent = message;
        msgEl.appendChild(textSpan);

        // Optional: Copy Button (for vouchers)
        if (options.copyText) {
            const copyButton = document.createElement('button');
            copyButton.textContent = options.buttonLabel || 'Copy';
            copyButton.className = 'btn btn-sm';
            copyButton.style.marginLeft = '15px';
            copyButton.style.color = 'var(--color-background)';
            copyButton.style.backgroundColor = 'var(--color-text-light)';
            copyButton.onclick = () => {
                navigator.clipboard.writeText(options.copyText)
                    .then(() => showToast('Copied!', 'success'))
                    .catch(() => showToast('Failed to copy.', 'error'));
            };
            msgEl.appendChild(copyButton);
        }

        this.toastTimeout = setTimeout(() => {
            toast.classList.add('hidden');
        }, options.duration || 6000);
    },

    getColorForType(type) {
        switch(type) {
            case 'success': return 'var(--color-success)';
            case 'error': return 'var(--color-danger)';
            case 'warning': return 'var(--color-warning)';
            case 'info': return 'var(--color-info)';
            case 'voucher': return 'var(--color-primary)';
            default: return 'var(--color-primary)';
        }
    },

    getIconForType(type) {
        switch(type) {
            case 'success': return '✅';
            case 'error': return '❌';
            case 'warning': return '⚠️';
            case 'info': return 'ℹ️';
            case 'voucher': return '🎁';
            default: return '🔔';
        }
    },

    // Specific helper for vouchers as seen in app.js
    showVoucher(title, message, code) {
        this.show(title, message, 'voucher', {
            copyText: code,
            buttonLabel: 'Copy Code',
            duration: 10000
        });
    }
};

window.SmartNotification = SmartNotification;
// For backward compatibility
window.showVoucherNotification = (t, m, c) => SmartNotification.showVoucher(t, m, c);
