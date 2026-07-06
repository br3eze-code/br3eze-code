/* ==========================================================
   p2p-credit.js — Direct user-to-user credit sharing
   Depends on: firebase (auth/db/currentUser from app.js)

   Wires the existing #shareCreditModal / #shareCreditForm (already in
   index.html, previously unbound) to a real Firestore transfer: resolve
   the recipient by email, atomically move credits, and write a paired
   ledger entry on both sides (p2p_transfer_sent / p2p_transfer_received)
   so both users' transaction histories show the transfer.

   If js/14a.crypto.js + js/14.mesh.nearby.js (the offline P2P mesh
   gossip modules) are also loaded, an offline/no-network share falls
   back to GossipService.broadcastCreditSync() so credit can still move
   between two nearby devices without an internet connection.
   ========================================================== */
'use strict';

function openShareCredit() {
    document.getElementById('shareCreditForm')?.reset();
    openModal('shareCreditModal');
}
window.openShareCredit = openShareCredit;

async function shareCredit(recipientEmail, amount) {
    if (!(amount > 0)) throw new Error('Enter a valid amount.');
    if (!currentUser) throw new Error('Not signed in.');
    if (recipientEmail.toLowerCase() === (currentUser.email || '').toLowerCase()) {
        throw new Error('You cannot share credit with yourself.');
    }
    if ((currentUser.credits || 0) < amount) throw new Error('Insufficient credits.');

    // Offline fallback: no network, but the mesh gossip modules are loaded.
    if (!navigator.onLine && window.GossipService && typeof window.GossipService.broadcastCreditSync === 'function') {
        const snap = await db.collection('users').where('email', '==', recipientEmail).limit(1).get().catch(() => null);
        const recipientId = snap && !snap.empty ? snap.docs[0].id : null;
        if (!recipientId) throw new Error('Recipient not found (and offline -- cannot look up new users).');
        window.GossipService.broadcastCreditSync(recipientId, amount);
        await DataStore.updateUser(currentUser.id, { credits: firebase.firestore.FieldValue.increment(-amount) });
        currentUser.credits = (currentUser.credits || 0) - amount;
        return { recipientId, viaMesh: true };
    }

    const snap = await db.collection('users').where('email', '==', recipientEmail).limit(1).get();
    if (snap.empty) throw new Error('No account found with that email.');
    const recipientDoc = snap.docs[0];
    const recipientId = recipientDoc.id;
    if (recipientId === currentUser.id) throw new Error('You cannot share credit with yourself.');

    const senderRef = db.collection('users').doc(currentUser.id);
    const recipientRef = db.collection('users').doc(recipientId);

    await db.runTransaction(async (tx) => {
        const senderSnap = await tx.get(senderRef);
        const senderCredits = senderSnap.data().credits || 0;
        if (senderCredits < amount) throw new Error('Insufficient credits.');

        tx.update(senderRef, { credits: firebase.firestore.FieldValue.increment(-amount) });
        tx.update(recipientRef, { credits: firebase.firestore.FieldValue.increment(amount) });

        tx.set(db.collection('transactions').doc(), {
            userId: currentUser.id, type: 'p2p_transfer_sent', amount: -amount,
            description: `Shared $${amount.toFixed(2)} with ${recipientEmail}`,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        tx.set(db.collection('transactions').doc(), {
            userId: recipientId, type: 'p2p_transfer_received', amount: amount,
            description: `Received $${amount.toFixed(2)} from ${currentUser.email}`,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
    });

    currentUser.credits = (currentUser.credits || 0) - amount;
    return { recipientId, viaMesh: false };
}
window.shareCredit = shareCredit;

document.getElementById('shareCreditForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('shareRecipientEmail').value.trim();
    const amount = parseFloat(document.getElementById('shareAmount').value);
    try {
        const result = await shareCredit(email, amount);
        showToast(
            result.viaMesh
                ? `Sent $${amount.toFixed(2)} via nearby mesh (will sync when back online).`
                : `Sent $${amount.toFixed(2)} to ${email}.`,
            'success'
        );
        closeModal('shareCreditModal');
        if (typeof updateDashboard === 'function') updateDashboard();
    } catch (err) {
        showToast(err.message, 'error');
    }
});
