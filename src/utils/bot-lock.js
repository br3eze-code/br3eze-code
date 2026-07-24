import fs from 'fs';
import path from 'path';
import { PROFILE_DIR } from '../core/config.js';

/**
 * Single-instance file lock for the Telegram bot poller.
 * Prevents two gateway processes (e.g. a stale process + a restarted one)
 * from long-polling the same bot token at once, which Telegram rejects with
 * a 409 Conflict.
 */

const LOCK_FILE = path.join(PROFILE_DIR, 'telegram-bot.lock');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by another user — treat as alive
  }
}

/** Returns true if the lock was acquired (or reclaimed from a dead process). */
function acquireBotLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const heldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      if (heldPid && heldPid !== process.pid && isProcessAlive(heldPid)) {
        return false; // another live instance holds the lock
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
    return true;
  } catch (e) {
    // Fail open — a filesystem hiccup shouldn't block the bot from starting.
    return true;
  }
}

function releaseBotLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const heldPid = fs.readFileSync(LOCK_FILE, 'utf8').trim();
      if (heldPid === process.pid.toString()) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch (_) {
    // best-effort cleanup
  }
}

export { acquireBotLock, releaseBotLock, LOCK_FILE };
