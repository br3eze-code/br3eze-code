/**
 * env.js — Browser-side environment bridge
 *
 * PURPOSE:
 *   Provides window.ENV to the browser before any app script runs.
 *   When AgentOS gateway IS running it serves this file from memory
 *   at /js/env.js with live values injected from process.env.
 *   This static fallback is used only during local development or
 *   when the file is opened directly (file:// protocol).
 *
 * ⚠  NEVER commit real API keys here for a public repository.
 *    Rotate the GATEWAY_TOKEN immediately if this file is exposed.
 *    In production the gateway's dynamic /js/env.js endpoint takes
 *    precedence over this file (express.static is registered after
 *    the dynamic route).
 */

// Bail if the gateway-injected version already populated ENV.
if (!window.ENV) {
    // Derive the gateway URL from the page origin so this works from any
    // device on the network (phones, tablets), not just localhost.
    const _gwOrigin = (typeof window !== 'undefined' && window.location?.origin &&
        window.location.origin !== 'null')
        ? window.location.origin
        : 'http://localhost:3000';

    window.ENV = {
        // ── Firebase ──────────────────────────────────────────────────────
        FIREBASE_API_KEY: 'AIzaSyANPQZKsAV9VsW9vKZJ3ghhrpnkxuLfdP8',
        FIREBASE_PROJECT_ID: 'br3eze-africa-312df',

        // Derived values (mirrors gateway-engine.js injection logic)
        get FIREBASE_AUTH_DOMAIN() { return `${this.FIREBASE_PROJECT_ID}.firebaseapp.com`; },
        get FIREBASE_DATABASE_URL() { return `https://${this.FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`; },
        get FIREBASE_STORAGE_BUCKET() { return `${this.FIREBASE_PROJECT_ID}.appspot.com`; },

        // ── AI ────────────────────────────────────────────────────────────
        GEMINI_API_KEY: 'AIzaSyBHXTvmCGsppeT1b3R2vKD1pLOUS34Y4ZU',

        // ── Gateway ───────────────────────────────────────────────────────
        // Derived from the origin that served this page — works on any device/network
        GATEWAY_URL: _gwOrigin,
        GATEWAY_PORT: window.location?.port || '3000',
        GATEWAY_TOKEN: 'b3e35062507272831797730183561204',

        // ── Feature flags ─────────────────────────────────────────────────
        ALLOWED_ORIGINS: '*'
    };
}
