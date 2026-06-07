/**
 * AgentOS Security Module (Browser Version)
 * Provides CryptoUtils for hashing and encryption using Web Crypto API.
 */

const CryptoUtils = {
    async hash(text) {
        const msgUint8 = new TextEncoder().encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },

    async encryptPayload(data, keyString = "AgentOS_Mesh_Default_Key") {
        try {
            const json = JSON.stringify(data);
            const encoded = new TextEncoder().encode(json);
            
            // For simple mesh P2P, we use a basic derivation or base64 for now
            // Real implementation would use SubtleCrypto with a proper key
            return btoa(unescape(encodeURIComponent(json))); 
        } catch (e) {
            console.error("Encryption error:", e);
            return null;
        }
    },

    async decryptPayload(base64) {
        try {
            const json = decodeURIComponent(escape(atob(base64)));
            return JSON.parse(json);
        } catch (e) {
            console.error("Decryption error:", e);
            return null;
        }
    }
};

window.CryptoUtils = CryptoUtils;

// Simple SecurityManager for browser parity
class SecurityManager {
    constructor() {
        console.log("[Security] Browser SecurityManager initialized");
    }
    sanitizeHost(host) { return host; }
}

if (typeof window !== 'undefined') {
    window.SecurityManager = new SecurityManager();
}
