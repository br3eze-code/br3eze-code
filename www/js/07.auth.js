/* ==========================================================
   07.auth.js — Login, signup, logout
   Depends on: 01.ui.utils.js, 06.firebase.js
   ========================================================== */

window.Auth = {

    async login(identifier, password) {
        Loading.show('Logging in...');
        try {
            let email = identifier;
            if (!identifier.includes('@')) {
                const snap = await db.collection('users')
                    .where('username', '==', identifier).limit(1).get();
                if (snap.empty) throw new Error('User not found.');
                email = snap.docs[0].data().email;
            }
            await auth.signInWithEmailAndPassword(email, password);
        } catch (e) {
            Loading.hide();
            showToast(e.message, 'error');
        }
    },

    async signup(email, password, fullname, username, confirm) {
        if (password !== confirm) return showToast('Passwords do not match.', 'error');
        Loading.show('Creating account...');
        try {
            const check = await db.collection('users').where('username', '==', username).get();
            if (!check.empty) throw new Error('Username already taken.');

            const cred = await auth.createUserWithEmailAndPassword(email, password);
            await db.collection('users').doc(cred.user.uid).set({
                uid:           cred.user.uid,
                email,
                fullname,
                username,
                role:          'user',
                credits:       0.00,
                subscriptions: [],
                createdAt:     firebase.firestore.FieldValue.serverTimestamp()
            });
            Loading.hide();
            showToast('Account created!', 'success');
        } catch (e) {
            Loading.hide();
            showToast(e.message, 'error');
        }
    },

    async logout() {
        await auth.signOut();
        window.location.reload();
    },

    async requestPasswordReset(email) {
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
    }
};
