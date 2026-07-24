
/**
 * Verified channel linking: consumes a short-lived 6-digit code that the
 * Power Connect app wrote to Firestore `linkCodes/{code}` while the user was
 * password-authenticated, then binds the chat identity (telegram chat id /
 * whatsapp jid) to that Firebase account via users/{uid}.channels.<platform>.
 *
 * This is the ONLY path that may bind a channel to an account. Email
 * addresses typed into a chat are hints, never proof — see the email-capture
 * blocks in TelegramChannel/WhatsappChannel.
 */

import { logger } from '../logger.js';
import { getDatabase } from '../database.js';

const CODE_RE = /^\d{6}$/;

/**
 * @param {string} code       6-digit code from the app
 * @param {string} platform   'telegram' | 'whatsapp' | ...
 * @param {string} channelId  chat id / jid to bind
 * @returns {{ok: boolean, message: string, uid?: string}}
 */
async function verifyLinkCode(code, platform, channelId) {
    const cleaned = String(code || '').trim();
    if (!CODE_RE.test(cleaned)) {
        return { ok: false, message: 'That does not look like a link code. Open the Power Connect app → Settings → Link Chat Account, then send: /link 123456' };
    }

    const db = await getDatabase();
    if (!db.db) {
        return { ok: false, message: 'Account linking requires the Firebase backend, which is not configured on this node.' };
    }

    const ref = db.db.collection('linkCodes').doc(cleaned);

    try {
        // Transaction: single-use consumption even under concurrent attempts.
        const uid = await db.db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) throw new Error('CODE_NOT_FOUND');
            const data = snap.data();
            if (data.used) throw new Error('CODE_USED');
            const expiresAt = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : Number(data.expiresAt);
            if (!expiresAt || Date.now() > expiresAt) throw new Error('CODE_EXPIRED');
            if (!data.uid) throw new Error('CODE_INVALID');
            tx.update(ref, { used: true, usedAt: Date.now(), platform, channelId: String(channelId) });
            return data.uid;
        });

        await db.linkChannel(uid, platform, channelId);

        let name = '';
        try {
            const user = await db.getUser(uid);
            name = user?.fullname || user?.username || '';
        } catch (_) {}

        logger.info(`[Link] ${platform}:${channelId} verified-linked to uid=${uid}`);
        return { ok: true, uid, message: `✅ Linked! This chat is now connected to ${name ? `*${name}*'s` : 'your'} Power Connect account.` };
    } catch (e) {
        const reasons = {
            CODE_NOT_FOUND: '❌ Code not found. Generate a fresh one in the app (Settings → Link Chat Account).',
            CODE_USED: '❌ That code was already used. Generate a fresh one in the app.',
            CODE_EXPIRED: '❌ That code expired (codes last 10 minutes). Generate a fresh one in the app.',
            CODE_INVALID: '❌ That code is invalid. Generate a fresh one in the app.'
        };
        if (reasons[e.message]) return { ok: false, message: reasons[e.message] };
        logger.error(`[Link] Verification error: ${e.message}`);
        return { ok: false, message: '⚠️ Linking failed due to a system error. Please try again.' };
    }
}

export { verifyLinkCode };
