
// src/sessionStore.js — lightweight in-process session persistence
const _store = new Map();
function saveSession(session) {
  _store.set(session.id, { ...session, savedAt: Date.now() });
  return session;
}
function loadSession(id) { return _store.get(id) || null; }
function deleteSession(id) { return _store.delete(id); }
function listSessions() { return [..._store.values()]; }
export { saveSession, loadSession, deleteSession, listSessions };