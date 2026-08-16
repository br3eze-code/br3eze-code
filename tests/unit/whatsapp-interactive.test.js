import {
  extractWhatsAppAction,
  buildReplyButtons,
  buildListMessage,
} from '../../src/channels/whatsapp-interactive.js';

describe('WhatsApp interactive navigation', () => {
  test('extracts a stable reply-button ID', () => {
    expect(extractWhatsAppAction({
      buttonsResponseMessage: { selectedButtonId: 'nav:back' },
    })).toBe('nav:back');
  });

  test('extracts a stable list-row ID', () => {
    expect(extractWhatsAppAction({
      listResponseMessage: {
        singleSelectReply: { selectedRowId: 'flow:provider:google' },
      },
    })).toBe('flow:provider:google');
  });

  test('extracts native-flow IDs defensively', () => {
    expect(extractWhatsAppAction({
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          paramsJson: JSON.stringify({ id: 'nav:cancel' }),
        },
      },
    })).toBe('nav:cancel');
  });

  test('builds at most three reply buttons with stable IDs', () => {
    const payload = buildReplyButtons({
      text: 'Choose an action',
      buttons: [
        { id: 'nav:back', label: '← Back' },
        { id: 'nav:cancel', label: 'Cancel' },
      ],
    });

    expect(payload.buttons).toHaveLength(2);
    expect(payload.buttons[0].buttonId).toBe('nav:back');
    expect(payload.buttons[1].buttonText.displayText).toBe('Cancel');
  });

  test('builds a list menu with stable row IDs', () => {
    const payload = buildListMessage({
      text: 'Choose a provider',
      rows: [
        { id: 'flow:provider:github', label: 'GitHub' },
        { id: 'nav:back', label: '← Back' },
      ],
    });

    expect(payload.sections[0].rows.map((row) => row.rowId)).toEqual([
      'flow:provider:github',
      'nav:back',
    ]);
  });

  test('enforces WhatsApp reply-button and list limits', () => {
    expect(() => buildReplyButtons({
      text: 'Too many',
      buttons: [1, 2, 3, 4].map((id) => ({ id, label: String(id) })),
    })).toThrow(/between 1 and 3/);

    expect(() => buildListMessage({
      text: 'Too many',
      rows: Array.from({ length: 11 }, (_, id) => ({ id, label: String(id) })),
    })).toThrow(/between 1 and 10/);
  });
});
