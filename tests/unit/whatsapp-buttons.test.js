/**
 * Unit tests for WhatsAppChannel's numbered-choice "buttons" feature.
 * WhatsApp deprecated real outgoing interactive-button messages for
 * unofficial clients, so this tests the numbered-list + reply-matching
 * fallback that stands in for them.
 */

process.env.AGENTOS_PROFILE = 'test-whatsapp-buttons';

import WhatsAppChannel from '../../src/core/channels/WhatsappChannel.js';

describe('WhatsAppChannel button reply resolution', () => {
  let channel;

  beforeEach(() => {
    channel = new WhatsAppChannel({});
  });

  const buttons = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'voucher', label: 'Create voucher' },
    { id: 'wallet', label: 'Check wallet balance' },
  ];

  test('resolves a numeric reply to the correct button by index', () => {
    expect(channel._resolveButtonReply('1', buttons)).toEqual(buttons[0]);
    expect(channel._resolveButtonReply('2', buttons)).toEqual(buttons[1]);
    expect(channel._resolveButtonReply('3', buttons)).toEqual(buttons[2]);
  });

  test('resolves a numeric reply with surrounding whitespace', () => {
    expect(channel._resolveButtonReply('  2  ', buttons)).toEqual(buttons[1]);
  });

  test('resolves a reply matching the button id case-insensitively', () => {
    expect(channel._resolveButtonReply('Voucher', buttons)).toEqual(buttons[1]);
    expect(channel._resolveButtonReply('WALLET', buttons)).toEqual(buttons[2]);
  });

  test('resolves a reply matching the button label case-insensitively', () => {
    expect(channel._resolveButtonReply('create voucher', buttons)).toEqual(buttons[1]);
  });

  test('returns null for an out-of-range number', () => {
    expect(channel._resolveButtonReply('0', buttons)).toBeNull();
    expect(channel._resolveButtonReply('4', buttons)).toBeNull();
    expect(channel._resolveButtonReply('99', buttons)).toBeNull();
  });

  test('returns null for unrelated text', () => {
    expect(channel._resolveButtonReply('banana', buttons)).toBeNull();
  });

  test('returns null for empty/undefined input without throwing', () => {
    expect(channel._resolveButtonReply('', buttons)).toBeNull();
    expect(channel._resolveButtonReply(undefined, buttons)).toBeNull();
  });

  test('sendButtons throws on an empty buttons array', async () => {
    await expect(
      channel.sendButtons('123@s.whatsapp.net', { title: 'x', buttons: [], resultAction: 'y' })
    ).rejects.toThrow('non-empty buttons array');
  });

  test('sendButtons composes a numbered list and arms pendingInputs for button_reply', async () => {
    channel.send = jest.fn().mockResolvedValue({ success: true });
    await channel.sendButtons('123@s.whatsapp.net', {
      title: 'Pick one',
      buttons,
      resultAction: 'command',
    });

    expect(channel.send).toHaveBeenCalledTimes(1);
    const [jid, text] = channel.send.mock.calls[0];
    expect(jid).toBe('123@s.whatsapp.net');
    expect(text).toContain('1.');
    expect(text).toContain('Dashboard');
    expect(text).toContain('2.');
    expect(text).toContain('Create voucher');

    const pending = channel.pendingInputs.get('123@s.whatsapp.net');
    expect(pending.action).toBe('button_reply');
    expect(pending.data.buttons).toEqual(buttons);
    expect(pending.data.resultAction).toBe('command');
  });
});
