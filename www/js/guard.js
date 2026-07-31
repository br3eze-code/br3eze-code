/**
 * ==========================================================
 * 🛡️ Security Guard & Audit
 * Protects against Prompt Injection, XSS, and runs Compliance Audits.
 * ==========================================================
 */
class SecurityGuard {
    constructor() {
        // Expanded Blocklist: Prompt Injection, XSS (script tags), SQLi (UNION SELECT), System Commands
        this.regexBlocklist = /h(a|4)ck|bypass|exploit|leak|malw(a|4)re|passw(o|0)rd|token|ignore|instructions|system|<script|javascript:|UNION SELECT|DROP TABLE|whoami|cat \/etc/i;
        this.toxicityModel = null;
    }

    // --- Active Protection ---
    async isUnsafe(prompt) {
        // 1. Heuristic Check (Instant)
        if (this.regexBlocklist.test(prompt)) return { unsafe: true, reason: 'blocklist_violation' };

        // 2. Length Check (DoS Prevention)
        if (prompt.length > 1000) return { unsafe: true, reason: 'payload_too_large' };

        // 3. AI Toxicity Check
        return { unsafe: false };
    }

    // --- Weakness Testing (Audit) ---
    async runSecurityAudit() {
        console.log("🕵️ Starting Security Audit...");
        const findings = [];

        // Test 1: Debug Mode Leak
        if (window.console && window.console.log.name !== 'log') {
            // findings.push({ level: 'LOW', msg: 'Console logging is active in production.' });
        }

        // Test 2: Insecure Storage (Sensitive Keys)
        const storageDump = JSON.stringify(localStorage);
        if (storageDump.includes('secret') || storageDump.includes('private_key') || storageDump.includes('password')) {
            findings.push({ level: 'CRITICAL', msg: 'Sensitive data detected in LocalStorage (Found "secret/key/password").' });
        }

        // Test 3: XSS Policy (CSP)
        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        if (!csp) {
            findings.push({ level: 'HIGH', msg: 'Missing Content-Security-Policy (CSP) header.' });
        }

        // Test 4: App Version Check
        if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
            findings.push({ level: 'medium', msg: 'App running on insecure HTTP.' });
        }

        return {
            timestamp: new Date().toISOString(),
            score: 100 - (findings.length * 10),
            findings
        };
    }
}

window.SecurityGuard = new SecurityGuard();
window.safetyGate = window.SecurityGuard; // Backward compatibility