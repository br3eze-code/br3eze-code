/* ==========================================================
   roles.js — Central 3-role permission model
   Depends on: nothing (pure functions over a user object)

   Roles:
     admin   — full read/write access everywhere, printer + MAC
               device tools.
     partner — network-settings-only view; owns one entry in the
               `partners` collection (ssid/password + 30% commission
               on sales attributed to their network).
     user    — normal hotspot customer. Gets hotspot access if they
               have an active plan, OR unconditionally free access
               if flagged `isFamily: true` on their user doc.
   ========================================================== */
'use strict';

window.Roles = Object.freeze({
    ADMIN: 'admin',
    PARTNER: 'partner',
    USER: 'user'
});

window.Permissions = {
    isAdmin(user) { return !!user && user.role === window.Roles.ADMIN; },
    isPartner(user) { return !!user && user.role === window.Roles.PARTNER; },
    isFamily(user) { return !!user && user.isFamily === true; },

    // Admin: full read/write access to everything in the app.
    canReadAll(user) { return this.isAdmin(user); },
    canWriteAll(user) { return this.isAdmin(user); },

    // Admin-only hardware tools: receipt printer + connected-device MAC dropdown.
    canAccessHardware(user) { return this.isAdmin(user); },

    // Partner: can manage only their OWN partner network entry (ssid/password).
    // Admin can also manage any partner's network (full write access).
    canManageOwnNetwork(user) { return this.isAdmin(user) || this.isPartner(user); },
    // The global hotspot network settings (the router's main SSID) stay admin-only.
    canManageGlobalNetwork(user) { return this.isAdmin(user); },

    hasActivePlan(user) {
        if (!user) return false;
        const subs = user.subscriptions || [];
        return subs.some(s => (s.expiresAt?.seconds || 0) * 1000 > Date.now());
    },

    // Free, unmetered hotspot access: admins and flagged family members,
    // regardless of credits/plan/partner status.
    hasFreeAccess(user) { return this.isAdmin(user) || this.isFamily(user); },

    // Overall "may use the hotspot right now" check used by the connect/
    // disconnect flow.
    canAccessHotspot(user) { return this.hasFreeAccess(user) || this.hasActivePlan(user); }
};
