/* Domain-neutral client boundary.
 * www/ owns UX/device orchestration; domain rules remain server-side.
 */
(function (global) {
    'use strict';

    var CLIENT_KEY = 'agentos_client_context';
    var RESOURCE_TYPES = ['product', 'service', 'subscription', 'digital'];

    function readContext() {
        try { return JSON.parse(localStorage.getItem(CLIENT_KEY) || '{}'); } catch (_) { return {}; }
    }

    function writeContext(next) {
        var current = readContext();
        var value = Object.assign({}, current, next || {});
        localStorage.setItem(CLIENT_KEY, JSON.stringify(value));
        return value;
    }

    function normalizeResource(input) {
        var value = input || {};
        var type = String(value.resourceType || value.type || '').toLowerCase();
        if (!RESOURCE_TYPES.includes(type)) type = 'product';
        return {
            resourceType: type,
            resourceId: value.resourceId || value.id || null,
            sku: value.sku || value.code || null,
            quantity: Math.max(1, Number(value.quantity || 1)),
            inventoryId: value.inventoryId || null
        };
    }

    async function apiFetch(url, options) {
        options = options || {};
        var headers = Object.assign({}, options.headers || {});
        headers['X-AgentOS-Client'] = 'pwa';
        var session = global.SupabaseAuth && global.SupabaseAuth.getSession
            ? global.SupabaseAuth.getSession() : null;
        if (session && session.access_token) headers.Authorization = 'Bearer ' + session.access_token;
        var fetcher = global.SupabaseAuth && global.SupabaseAuth.apiFetch
            ? global.SupabaseAuth.apiFetch : global.fetch.bind(global);
        return fetcher(url, Object.assign({}, options, { headers: headers }));
    }

    global.AgentOSClient = {
        version: '1.0.0',
        getContext: readContext,
        setContext: writeContext,
        classifyResource: normalizeResource,
        setResource: function (resource) { return writeContext({ resource: normalizeResource(resource) }); },
        clearResource: function () {
            var context = readContext();
            delete context.resource;
            localStorage.setItem(CLIENT_KEY, JSON.stringify(context));
            return context;
        },
        apiFetch: apiFetch,
        resourceTypes: RESOURCE_TYPES.slice(),
        clientType: 'pwa'
    };
})(window);
