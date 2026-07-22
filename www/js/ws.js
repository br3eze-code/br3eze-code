/**
 * AgentOS Hermes — ws.js
 * WebSocket manager · auto-reconnect · heartbeat · event bus
 */
'use strict';

const WS = (() => {
  let _ws       = null;
  let _url      = '';
  let _token    = '';
  let _retry    = 0;
  let _retryTid = null;
  let _hbTid    = null;
  let _dead     = false;

  const _handlers = {};

  // ── Public API ─────────────────────────────────────────────────
  function on(event, fn) {
    if (!_handlers[event]) _handlers[event] = [];
    _handlers[event].push(fn);
  }

  function off(event, fn) {
    if (!_handlers[event]) return;
    _handlers[event] = _handlers[event].filter(h => h !== fn);
  }

  function emit(event, data) {
    (_handlers[event] || []).forEach(fn => { try { fn(data); } catch(_){} });
  }

  function connect(baseUrl, token) {
    _dead  = false;
    _url   = baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + CFG.WS_PATH;
    _token = token || '';
    _open();
  }

  function disconnect() {
    _dead = true;
    clearTimeout(_retryTid);
    clearInterval(_hbTid);
    if (_ws) { try { _ws.close(1000); } catch(_){} _ws = null; }
  }

  function send(obj) {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function isOpen() {
    return !!_ws && _ws.readyState === WebSocket.OPEN;
  }

  // ── Internal ───────────────────────────────────────────────────
  function _open() {
    if (_dead || !_url) return;
    try {
      const wsUrl = _token ? `${_url}?token=${encodeURIComponent(_token)}` : _url;
      _ws = new WebSocket(wsUrl);
    } catch(e) {
      _scheduleRetry();
      return;
    }

    _ws.onopen = () => {
      _retry = 0;
      emit('open', {});
      _startHeartbeat();
    };

    _ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        // route to specific event + generic 'message'
        if (msg.type) emit(msg.type, msg);
        emit('message', msg);
      } catch(_) {}
    };

    _ws.onerror = () => {};  // onclose handles reconnect

    _ws.onclose = (ev) => {
      clearInterval(_hbTid);
      _ws = null;
      emit('close', { code: ev.code });
      if (!_dead && _retry < CFG.WS_MAX_RETRY) _scheduleRetry();
      else if (!_dead) emit('dead', {});
    };
  }

  function _scheduleRetry() {
    _retry++;
    const delay = Math.min(CFG.WS_RECONNECT_MS * _retry, 30000);
    emit('retry', { attempt: _retry, delay });
    _retryTid = setTimeout(_open, delay);
  }

  function _startHeartbeat() {
    clearInterval(_hbTid);
    _hbTid = setInterval(() => {
      if (!send({ type: 'ping', ts: Date.now() })) {
        clearInterval(_hbTid);
      }
    }, 20000);
  }

  return { on, off, emit, connect, disconnect, send, isOpen };
})();
