/* Compatibility shim: password recovery is owned by 07.auth.js.
   This file deliberately contains no Firebase authentication calls. */

if (typeof window.toggleForgotPassword !== 'function') {
    window.toggleForgotPassword = function () {
        document.getElementById('loginForm')?.classList.toggle('hidden');
        document.getElementById('forgotPasswordForm')?.classList.toggle('hidden');
    };
}
