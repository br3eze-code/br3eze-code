/* ==========================================================
   FILE: crypto.js
   DESCRIPTION: Robust E2EE for P2P Mesh Gossip (AES-GCM)
   ========================================================== */

const CryptoUtils = {
    SYSTEM_SECRET: "BR3EZE_MESH_SECURE_V1_2026_KEY",
    _cachedKey: null,
    SALT: "BreezeAfricaSalt", // In prod, this would be randomized or derived

    async _getEncryptionKey() {
        if (this._cachedKey) return this._cachedKey;

        const dynamicSalt = await this._getDynamicSalt();
        const encoder = new TextEncoder();
        const saltBuffer = encoder.encode(dynamicSalt);

        const baseKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(this.SYSTEM_SECRET),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        this._cachedKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: saltBuffer,
                iterations: 100000,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        return this._cachedKey;
    },
    async _getDynamicSalt() {
        let salt = localStorage.getItem('crypto_salt');
        if (!salt) {
            const randomValues = crypto.getRandomValues(new Uint8Array(16));
            salt = Array.from(randomValues).map(b => b.toString(16).padStart(2, '0')).join('');
            localStorage.setItem('crypto_salt', salt);
        }
        return salt;
    },

    async init() {
        if (!window.crypto || !window.crypto.subtle) {
            console.error("Crypto API not supported (Secure Context required)");
            return false;
        }
        return true;
    },

    /**
     * Encrypts a payload for secure Mesh Relay
     */
    async encryptPayload(data) {
        try {
            const key = await this._getEncryptionKey();
            const iv = crypto.getRandomValues(new Uint8Array(12)); // GCM standard IV
            const encoder = new TextEncoder();
            const encodedData = encoder.encode(JSON.stringify(data));

            const ciphertext = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                encodedData
            );

            // Combine IV + Ciphertext into a single Base64 string
            const combined = new Uint8Array(iv.length + ciphertext.byteLength);
            combined.set(iv, 0);
            combined.set(new Uint8Array(ciphertext), iv.length);

            return btoa(String.fromCharCode(...combined));
        } catch (e) {
            console.error("[Crypto] AES-GCM Encryption failed:", e);
            return null;
        }
    },

    /**
     * Decrypts mesh data
     */
    async decryptPayload(base64Data) {
        try {
            const key = await this._getEncryptionKey();
            const binary = atob(base64Data);
            const combined = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);

            // Extract IV (first 12 bytes) and Ciphertext
            const iv = combined.slice(0, 12);
            const ciphertext = combined.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                ciphertext
            );

            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            console.warn("[Crypto] Decryption failed (invalid key or tampered data)");
            return null;
        }
    },

    async hash(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
};

window.CryptoUtils = CryptoUtils;
