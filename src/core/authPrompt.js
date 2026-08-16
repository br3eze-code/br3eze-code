import { DEFAULT_LOGIN_DOMAIN } from './config.js';

/**
 * src/core/authPrompt.js
 * ─────────────────────────────────────────────────────────────────
 * Shared "please authenticate" messaging for every channel. Used when
 * db.resolveUser() comes back null — i.e. the identifier isn't known
 * to Firebase Auth, Firestore, *or* the SQLite fallback, so this is
 * genuinely a new/unregistered contact rather than a lookup failure.
 *
 * One place for the login URL and copy, instead of each channel
 * hand-rolling its own string around the DEFAULT_LOGIN_DOMAIN literal.
 * ─────────────────────────────────────────────────────────────────
 */

function getLoginUrl(state = '') {
  const suffix = state ? `?state=${encodeURIComponent(String(state).slice(0, 240))}` : '';
  return `https://${DEFAULT_LOGIN_DOMAIN}/login${suffix}`;
}

function getLinkUrl(state = '') {
  const suffix = state ? `?state=${encodeURIComponent(String(state).slice(0, 240))}` : '';
  return `https://${DEFAULT_LOGIN_DOMAIN}/link${suffix}`;
}

/**
 * @param {'whatsapp'|'telegram'|'sms'|'ussd'|'email'|'slack'|'discord'|'generic'} channel
 * @returns {string} channel-appropriate prompt text
 */
function getAuthPrompt(channel = 'generic') {
  const url = getLoginUrl();
  switch (channel) {
    case 'whatsapp':
    case 'telegram':
    case 'slack':
    case 'discord':
      // These support basic markdown-ish formatting
      return (
        `👋 We don't have an account linked to this chat yet.\n\n` +
        `Please sign in or register at:\n${url}\n\n` +
        `Once you're logged in there, come back and message me again.`
      );
    case 'sms':
      // Keep SMS short — carriers often truncate/charge per segment
      return `Welcome! Please register/login at ${url} to continue.`;
    case 'ussd':
      // USSD screens are extremely space-constrained (often ~160 chars)
      return `No account found.\nRegister at:\n${DEFAULT_LOGIN_DOMAIN}/login`;
    case 'email':
      return (
        `<p>We don't have an account linked to this email address yet.</p>` +
        `<p>Please <a href="${url}">sign in or register here</a>, then reply to this email.</p>`
      );
    default:
      return `Please sign in or register at ${url} to continue.`;
  }
}

function getLinkPrompt(channel = 'generic', state = '') {
  const url = getLinkUrl(state);
  if (channel === 'sms' || channel === 'ussd') return `Link your account at ${url}`;
  if (channel === 'email') return `<p>Link this channel to your AgentOS account: <a href="${url}">continue</a>.</p>`;
  return `To link this channel, open:\n${url}\n\nNever send passwords or one-time codes in chat.`;
}

export { getAuthPrompt, getLoginUrl, getLinkPrompt, getLinkUrl };
