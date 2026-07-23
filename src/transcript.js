'use strict';
// src/transcript.js — lightweight conversation transcript store
// General-purpose: works for any agent, not domain-specific
class TranscriptStore {
  constructor({ entries = [], maxEntries = 200 } = {}) {
    this._entries = [...entries];
    this._maxEntries = maxEntries;
  }
  append(entry) {
    this._entries.push({ ...entry, ts: entry.ts || new Date().toISOString() });
    if (this._entries.length > this._maxEntries) this._entries.shift();
    return this;
  }
  toArray() { return [...this._entries]; }
  slice(n) { return this._entries.slice(-n); }
  clear() { this._entries = []; return this; }
  get length() { return this._entries.length; }
}
module.exports = { TranscriptStore };