/* ==========================================================
   FILE: forgot-password.js
   Small addon restoring the "Forgot password?" flow (Firebase
   sendPasswordResetEmail) on top of app.js's Auth object.
   Kept as a separate file rather than editing app.js directly
   so this survives future app.js updates without a merge conflict.
   ========================================================== */

function toggleForgotPassword() {
    document.getElementById('loginForm').classList.toggle('hidden');
    document.getElementById('forgotPasswordForm').classList.toggle('hidden');
}
window.toggleForgotPassword = toggleForgotPassword;

window.Auth.requestPasswordReset = async function (email) {
    if (!email) return showToast('Enter your email first.', 'error');
    Loading.show('Sending reset link...');
    try {
        await auth.sendPasswordResetEmail(email);
        Loading.hide();
        showToast('If that email has an account, a reset link is on its way.', 'success');
        toggleForgotPassword();
    } catch (e) {
        Loading.hide();
        // Firebase's own message is safe to show (doesn't reveal account existence
        // when email-enumeration protection is enabled in the Firebase console).
        showToast(e.message, 'error');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('forgotPasswordFormElement')?.addEventListener('submit', (e) => {
        e.preventDefault();
        window.Auth.requestPasswordReset(document.getElementById('forgotPasswordEmail').value);
    });
});
