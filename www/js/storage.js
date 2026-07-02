/**
 * AgentOS Hermes — storage.js
 * Thin localStorage wrapper; falls back to memory map if unavailable
 */
'use strict';

const Store = (() => {
  const _mem = {};
  let _ls = false;
  try {
    localStorage.setItem('_t', '1');
    localStorage.removeItem('_t');
    _ls = true;
  } catch (_) {}

  return {
    get(k, fallback = null) {
      try {
        const raw = _ls ? localStorage.getItem(k) : _mem[k];
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(k, v) {
      try {
        const s = JSON.stringify(v);
        if (_ls) localStorage.setItem(k, s);
        else _mem[k] = s;
      } catch (_) {}
    },
    del(k) {
      if (_ls) localStorage.removeItem(k);
      else delete _mem[k];
    },
  };
})();
