export function extractWhatsAppAction(message = {}) {
  const buttons = message.buttonsResponseMessage;
  if (buttons?.selectedButtonId) return buttons.selectedButtonId;

  const list = message.listResponseMessage;
  if (list?.singleSelectReply?.selectedRowId) {
    return list.singleSelectReply.selectedRowId;
  }

  const interactive = message.interactiveResponseMessage;
  const nativeFlow = interactive?.nativeFlowResponseMessage;
  if (nativeFlow?.paramsJson) {
    try {
      const params = JSON.parse(nativeFlow.paramsJson);
      return params.id || params.button_id || params.selectedRowId || null;
    } catch {
      return null;
    }
  }

  return null;
}

export function buildReplyButtons({ text, buttons, footer = 'AgentOS' }) {
  if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
    throw new Error('WhatsApp reply buttons require between 1 and 3 buttons');
  }

  return {
    text,
    footer,
    buttons: buttons.map(({ id, label }) => ({
      buttonId: String(id),
      buttonText: { displayText: String(label).slice(0, 20) },
      type: 1,
    })),
    headerType: 1,
  };
}

export function buildListMessage({ text, rows, title = 'AgentOS', footer = 'Select an option' }) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10) {
    throw new Error('WhatsApp list messages require between 1 and 10 rows');
  }

  return {
    text,
    footer,
    title,
    buttonText: 'Open menu',
    sections: [{
      title: 'Actions',
      rows: rows.map(({ id, label, description }) => ({
        rowId: String(id),
        title: String(label).slice(0, 24),
        ...(description ? { description: String(description).slice(0, 72) } : {}),
      })),
    }],
  };
}
