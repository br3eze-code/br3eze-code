/**
 * AgentOS Hermes — client.js
 * REST API client  · v1 / v2 / v3
 */
'use strict';

const Client = (() => {
  let _base = '', _token = '';

  function configure(url, token) {
    _base  = url.replace(/\/$/, '');
    _token = token || '';
  }

  async function request(path, opts = {}) {
    if (!_base) throw new Error('Gateway URL not configured');
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), CFG.API_TIMEOUT_MS);
    try {
      const res = await fetch(_base + path, {
        method:  opts.method || 'GET',
        signal:  ctrl.signal,
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${_token}`,
          ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      clearTimeout(tid);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json;
    } catch(e) {
      clearTimeout(tid);
      if (e.name === 'AbortError') throw new Error('Request timed out');
      throw e;
    }
  }

  // ── v1 ────────────────────────────────────────────────────────
  const v1 = {
    health:          ()    => request(`${CFG.API}/health`),
    systemStats:     ()    => request(`${CFG.API}/system/stats`),
    systemResources: ()    => request(`${CFG.API}/system/resources`),
    systemIdentity:  ()    => request(`${CFG.API}/system/identity`),
    ping:            (h,n) => request(`${CFG.API}/system/ping`, { method:'POST', body:{host:h,count:n||4}}),
    reboot:          ()    => request(`${CFG.API}/system/reboot`, { method:'POST'}),

    activeUsers:     ()    => request(`${CFG.API}/users/active`),
    allUsers:        ()    => request(`${CFG.API}/users/all`),
    addUser:         (u,p,pl)=> request(`${CFG.API}/users/add`,{method:'POST',body:{username:u,password:p,profile:pl}}),
    delUser:         (u)   => request(`${CFG.API}/users/${encodeURIComponent(u)}`,{method:'DELETE'}),
    disconnect:      (id)  => request(`${CFG.API}/users/${id}/disconnect`,{method:'POST'}),

    voucherStats:    ()    => request(`${CFG.API}/vouchers/stats`),
    vouchers:        (f)   => request(`${CFG.API}/vouchers?${new URLSearchParams(f||{})}`),
    getVoucher:      (c)   => request(`${CFG.API}/vouchers/${encodeURIComponent(c)}`),
    createVoucher:   (d)   => request(`${CFG.API}/vouchers`,{method:'POST',body:d}),
    redeemVoucher:   (c,u) => request(`${CFG.API}/vouchers/redeem`,{method:'POST',body:{code:c,user:u}}),
    voucherQR:       (c)   => request(`${CFG.API}/vouchers/${encodeURIComponent(c)}/qr`),
    bulkVouchers:    (n,p) => request(`${CFG.API3}/bulk/vouchers`,{method:'POST',body:{count:n,plan:p}}),

    plans:           ()    => request(`${CFG.API}/plans`),
    profiles:        ()    => request(`${CFG.API}/hotspot/profiles`),
    tools:           ()    => request(`${CFG.API}/tools`),
    runTool:         (t,p) => request(`${CFG.API}/tools/${t}`,{method:'POST',body:p||{}}),
    execute:         (t,p) => request(`${CFG.API}/execute`,{method:'POST',body:{tool:t,params:p||{}}}),
    nodes:           ()    => request(`${CFG.API}/nodes`),
    diagnostics:     ()    => request(`${CFG.API}/diagnostics`),
    interfaces:      ()    => request(`${CFG.API}/system/resources`),
  };

  // ── v2 ────────────────────────────────────────────────────────
  const v2 = {
    health:          ()    => request(`${CFG.API2}/health`),
    ask:             (p,s) => request(`${CFG.API2}/ask`,{method:'POST',body:{prompt:p,sessionId:s}}),
    financialSummary:()    => request(`${CFG.API2}/financial/summary`),
    financialReport: ()    => request(`${CFG.API2}/financial/report`),
    channels:        ()    => request(`${CFG.API2}/channels`),
    providers:       ()    => request(`${CFG.API2}/providers`),
    analyticsVouchers:()   => request(`${CFG.API2}/analytics/vouchers`),
    analyticsSystem: ()    => request(`${CFG.API2}/analytics/system`),
    nodes:           ()    => request(`${CFG.API2}/nodes`),
    sessions:        ()    => request(`${CFG.API2}/sessions`),
  };

  // ── v3 ────────────────────────────────────────────────────────
  const v3 = {
    diagnosticsFull: ()    => request(`${CFG.API3}/diagnostics/full`),
    connectivity:    ()    => request(`${CFG.API3}/diagnostics/connectivity`),
    config:          ()    => request(`${CFG.API3}/config`),
    bulkVouchers:    (n,p) => request(`${CFG.API3}/bulk/vouchers`,{method:'POST',body:{count:n,plan:p}}),
    bulkDisconnect:  (ids) => request(`${CFG.API3}/bulk/users/disconnect`,{method:'POST',body:{ids}}),
  };

  return { configure, request, v1, v2, v3,
    getBase: () => _base,
    hasConfig: () => !!_base,
  };
})();
