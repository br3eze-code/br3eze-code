
'use strict';
const fs = require('fs');
const path = require('path');

// ── 1. Patch TelegramChannel.js ───────────────────────────────────────────────
const tcPath = path.join(__dirname, '..', 'src', 'core', 'channels', 'TelegramChannel.js');
let tc = fs.readFileSync(tcPath, 'utf8');

const OLD_UPSERT = `                if (from) {
                    await db.upsertUser(chatId, {
                        username: from.username || null,
                        firstName: from.first_name || '',
                        lastName: from.last_name || '',
                        platform: 'telegram'
                    }).catch(e => logger.warn(\`Telegram user sync failed: \${e.message}\`));
                }`;

const NEW_UPSERT = `                if (from) {
                    // Register by chatId (Telegram numeric ID) and persist the channel link
                    await db.upsertUser(String(chatId), {
                        username: from.username || null,
                        firstName: from.first_name || '',
                        lastName: from.last_name || '',
                        platform: 'telegram',
                        channels: { telegram: String(chatId) },
                    }).catch(e => logger.warn(\`Telegram user sync failed: \${e.message}\`));

                    // Non-blocking: bridge Telegram chatId to Firebase Auth UID-keyed doc.
                    // Ensures resolveUser(firebaseUid) and resolveUser(chatId) find the same record.
                    db.resolveFirebaseUser(String(chatId), {
                        channel: 'telegram',
                        channelId: String(chatId),
                    }).catch(() => {});
                }`;

if (!tc.includes(OLD_UPSERT)) {
    console.error('❌ TelegramChannel: target block not found — check whitespace/line-endings');
    process.exit(1);
}
tc = tc.replace(OLD_UPSERT, NEW_UPSERT);
fs.writeFileSync(tcPath, tc, 'utf8');
console.log('✅ TelegramChannel.js patched');

// ── 2. Patch database.js — add resolveFirebaseUser after resolveUser ───────────
const dbPath = path.join(__dirname, '..', 'src', 'core', 'database.js');
let db = fs.readFileSync(dbPath, 'utf8');

// Only add if not already present
if (db.includes('resolveFirebaseUser')) {
    console.log('ℹ️  database.js already has resolveFirebaseUser — skipping');
} else {
    const ANCHOR = `    async upsertUser(userId, data) {`;
    const NEW_METHOD = `    /**
     * Resolve a user via Firebase Auth, then ensure a Firestore doc exists keyed by UID.
     *
     * Accepts: Firebase UID (28-char alphanumeric), email address, or phone number.
     * Optionally links a channel (e.g. telegram chatId) on first contact so that
     * both resolveUser(uid) and resolveUser(chatId) return the same record.
     *
     * @param {string} identifier  Firebase UID | email | phone | numeric chatId
     * @param {{ channel?: string, channelId?: string }} [opts]
     * @returns {Promise<object|null>}
     */
    async resolveFirebaseUser(identifier, opts = {}) {
        if (!this.db || !identifier) return null;
        const id = String(identifier);

        let authRecord = null;
        try {
            if (id.includes('@')) {
                authRecord = await admin.auth().getUserByEmail(id);
            } else if (id.startsWith('+') || /^\\d{7,15}$/.test(id)) {
                const phone = id.startsWith('+') ? id : \`+\${id}\`;
                authRecord = await admin.auth().getUserByPhoneNumber(phone);
            } else if (/^[A-Za-z0-9]{20,}$/.test(id)) {
                // Firebase UID format: 28-char alphanumeric e.g. "2Vjj7OM42RavT8U7JyLm6laI7Zi1"
                authRecord = await admin.auth().getUser(id);
            } else {
                // Numeric chatId — not an Auth identifier, skip Auth lookup
                return null;
            }
        } catch (e) {
            if (e.code !== 'auth/user-not-found') {
                logger.debug(\`[DB] resolveFirebaseUser(\${id}): \${e.message}\`);
            }
            return null;
        }

        if (!authRecord) return null;
        const uid = authRecord.uid;

        // Ensure the UID-keyed Firestore doc exists
        let firestoreUser = await this.getUser(uid);
        if (!firestoreUser) {
            firestoreUser = await this.createUser(uid, {
                uid,
                email:       authRecord.email       || null,
                phoneNumber: authRecord.phoneNumber  || null,
                fullname:    authRecord.displayName  || null,
                platform:    opts.channel            || 'firebase',
            });
            logger.info(\`[DB] Created Firestore doc for Firebase uid:\${uid}\`);
        }

        // Link channel on first contact (idempotent — only writes if not already set)
        if (opts.channel && opts.channelId && !firestoreUser.channels?.[opts.channel]) {
            await this.linkChannel(uid, opts.channel, opts.channelId);
            logger.info(\`[DB] Linked \${opts.channel}:\${opts.channelId} → uid:\${uid}\`);
        }

        return { ...firestoreUser, uid };
    }

    `;

    if (!db.includes(ANCHOR)) {
        console.error('❌ database.js: anchor not found');
        process.exit(1);
    }
    db = db.replace(ANCHOR, NEW_METHOD + ANCHOR);
    fs.writeFileSync(dbPath, db, 'utf8');
    console.log('✅ database.js patched — resolveFirebaseUser added');
}

// ── 3. Also upgrade resolveUser to call resolveFirebaseUser as step 7 ─────────
const OLD_RESOLVE_TAIL = `        // 6. Last resort: try all known channels if it looks like a numeric ID (chatId)
        if (/^\\d+$/.test(identifier)) {
            const telegramUser = await this.getUserByChannel('telegram', identifier);
            if (telegramUser) return telegramUser;
            const whatsappUser = await this.getUserByChannel('whatsapp', identifier);
            if (whatsappUser) return whatsappUser;
        }

        return null;
    }`;

const NEW_RESOLVE_TAIL = `        // 6. Try all known channels for numeric chatIds
        if (/^\\d+$/.test(identifier)) {
            const telegramUser = await this.getUserByChannel('telegram', identifier);
            if (telegramUser) return telegramUser;
            const whatsappUser = await this.getUserByChannel('whatsapp', identifier);
            if (whatsappUser) return whatsappUser;
        }

        // 7. Try Firebase Auth — covers UID hashes like "2Vjj7OM42RavT8U7JyLm6laI7Zi1"
        const byAuth = await this.resolveFirebaseUser(identifier);
        if (byAuth) return byAuth;

        return null;
    }`;

// Re-read db in case it was just written
db = fs.readFileSync(dbPath, 'utf8');
if (db.includes('// 7. Try Firebase Auth')) {
    console.log('ℹ️  resolveUser already has Auth step 7 — skipping');
} else if (db.includes(OLD_RESOLVE_TAIL)) {
    db = db.replace(OLD_RESOLVE_TAIL, NEW_RESOLVE_TAIL);
    fs.writeFileSync(dbPath, db, 'utf8');
    console.log('✅ database.js resolveUser upgraded with Auth step 7');
} else {
    console.warn('⚠️  resolveUser tail not found — manual check needed');
}

console.log('\nAll patches complete.');
