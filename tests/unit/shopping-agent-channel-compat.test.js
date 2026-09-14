import { describe, expect, test } from '@jest/globals';
import { platformFor, requestIdFor } from '../../src/core/shopping-agent.js';

describe('shopping agent channel compatibility', () => {
  const channels = [
    ['TelegramChannel', 'telegram'],
    ['WhatsappChannel', 'whatsapp'],
    ['SlackChannel', 'slack'],
    ['DiscordChannel', 'discord'],
    ['WebSocketChannel', 'websocket'],
    ['CLIChannel', 'cli'],
    ['EmailChannel', 'email'],
    ['SMSChannel', 'sms'],
  ];

  test.each(channels)('normalizes %s to the %s commerce platform', (name, expected) => {
    expect(platformFor({ constructor: { name } })).toBe(expected);
  });

  test('accepts common inbound transport request identifiers in priority order', () => {
    expect(requestIdFor({ requestId: 'request-1', messageId: 'message-1', id: 'id-1' })).toBe('request-1');
    expect(requestIdFor({ messageId: 'message-1', id: 'id-1' })).toBe('message-1');
    expect(requestIdFor({ eventId: 'event-1' })).toBe('event-1');
    expect(requestIdFor({ key: { id: 'transport-1' } })).toBe('transport-1');
    expect(requestIdFor({})).toBeNull();
  });

  test('does not use a channel address as a checkout idempotency key', () => {
    expect(requestIdFor({ from: { id: 'telegram-user' }, chat: { id: 'chat-1' } })).toBeNull();
    expect(requestIdFor({ remoteJid: 'user@s.whatsapp.net' })).toBeNull();
  });
});
