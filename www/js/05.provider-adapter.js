/* Provider-neutral frontend port. Provider SDKs register capabilities here. */
(function providerAdapter(global) {
  const state = { auth: null, data: null, events: null };

  global.AgentOSProviders = {
    registerAuth(adapter) { state.auth = adapter; return adapter; },
    registerData(adapter) { state.data = adapter; return adapter; },
    registerEvents(adapter) { state.events = adapter; return adapter; },
    getAuth() { return state.auth; },
    getData() { return state.data; },
    getEvents() { return state.events; },
    requireAuth() { if (!state.auth) throw new Error('No authentication provider registered'); return state.auth; },
    requireData() { if (!state.data) throw new Error('No data provider registered'); return state.data; }
  };
})(window);
