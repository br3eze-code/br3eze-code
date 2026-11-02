const GRAPH_API_VERSION = String(process.env.WHATSAPP_GRAPH_API_VERSION || '').trim();
const PHONE_NUMBER_ID = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
const ACCESS_TOKEN = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
const TEMPLATE_NAME = String(process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
const TEMPLATE_LANGUAGE = String(process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || 'en').trim();

export async function sendWhatsAppOtp({ to, code }) {
  if (!/^v\\d+\\.\\d+$/.test(GRAPH_API_VERSION) || !PHONE_NUMBER_ID || !ACCESS_TOKEN || !TEMPLATE_NAME) {
    throw new Error('WhatsApp Cloud API OTP delivery is not configured.');
  }
  if (!/^\\+[1-9]\\d{7,14}$/.test(String(to || '')) || !/^\\d{6}$/.test(String(code || ''))) {
    throw new TypeError('A valid E.164 recipient and six-digit code are required.');
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(PHONE_NUMBER_ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: to.slice(1), type: 'template',
      template: {
        name: TEMPLATE_NAME, language: { code: TEMPLATE_LANGUAGE },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }
        ]
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) throw new Error('WhatsApp OTP delivery failed.');
  return { messageId: result?.messages?.[0]?.id || null };
}
