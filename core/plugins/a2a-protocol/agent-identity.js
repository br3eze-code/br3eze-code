import fs from 'node:fs/promises';
import path from 'node:path';
import crypto, { X509Certificate } from 'node:crypto';

class AgentIdentity {
    constructor(spiffeID, mTLSConfig = {}) {
        this.spiffeID = spiffeID;
        this.mTLSConfig = mTLSConfig;
        this.cert = null;
        this.privateKey = null;
        this.trustBundle = null;
    }

    async loadCredentials() {
        try {
            const certPath = path.join(this.mTLSConfig.certPath, 'svid.pem');
            const keyPath = path.join(this.mTLSConfig.certPath, 'svid_key.pem');
            const bundlePath = path.join(this.mTLSConfig.certPath, 'bundle.pem');
            const [certPem, keyPem, bundlePem] = await Promise.all([
                fs.readFile(certPath, 'utf8'),
                fs.readFile(keyPath, 'utf8'),
                fs.readFile(bundlePath, 'utf8')
            ]);
            this.cert = new X509Certificate(certPem);
            this.privateKey = crypto.createPrivateKey(keyPem);
            this.trustBundle = bundlePem;
            const san = this.cert.subjectAltName;
            if (!san || !san.includes(this.spiffeID)) throw new Error(`SPIFFE ID mismatch: expected ${this.spiffeID}, cert has ${san}`);
        } catch (error) {
            if (this.mTLSConfig.enabled) throw new Error(`Failed to load SPIFFE credentials from ${this.mTLSConfig.certPath}: ${error.message}`);
        }
    }

    async signMessage(message) {
        if (!this.privateKey) return { ...message, _signature: null };
        const payload = JSON.stringify({ ...message, _signature: undefined });
        const signature = crypto.sign('sha256', Buffer.from(payload), this.privateKey);
        return { ...message, _signature: signature.toString('base64'), _signer: this.spiffeID, _certFingerprint: this.cert.fingerprint256 };
    }

    async verifyMessage(message, expectedSPIFFE) {
        if (!message._signature) {
            if (this.mTLSConfig.enabled) throw new Error('Message not signed');
            return message;
        }
        if (message._signer !== expectedSPIFFE) throw new Error(`Signer mismatch: expected ${expectedSPIFFE}, got ${message._signer}`);
        const { _signature, _signer, _certFingerprint, ...cleanMessage } = message;
        if (this.trustBundle) {
            const payload = JSON.stringify({ ...cleanMessage, _signature: undefined });
            const publicKey = crypto.createPublicKey(this.trustBundle);
            const valid = crypto.verify('sha256', Buffer.from(payload), publicKey, Buffer.from(_signature, 'base64'));
            if (!valid) throw new Error(`Invalid signature from ${expectedSPIFFE}`);
        }
        return cleanMessage;
    }
}

export { AgentIdentity };
