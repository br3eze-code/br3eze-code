import { isValidGraphApiVersion, isValidOtpCode, normalizePhone } from '../validation.js';

function configuration() {
  const version = String(process.env.WHATSAPP_GRAPH_API_VERSION || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const templateName = String(process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
  const language = String(process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || 'en').trim();

  if (!isValidGraphApiVersion(version) || !/^[0-9]+$/.test(phoneNumberId) || !accessToken || !templateName) {
    throw new Error('WhatsApp Cloud API OTP delivery is not configured.');
  }
  return { version, phoneNumberId, accessToken, templateName, language };
}

export async function sendWhatsAppOtp({ to, code }) {
  const config = configuration();
  const recipient = normalizePhone(to);
  if (!isValidOtpCode(code)) throw new TypeError('A six-digit verification code is required.');

  const endpoint = 'https://graph.facebook.com/' + config.version + '/' +
    encodeURIComponent(config.phoneNumberId) + '/messages';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipient.slice(1),
      type: 'template',
      template: {
        name: config.templateName,
        language: { code: config.language },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }]
          }
        ]
      }
    }),
    signal: AbortSignal.timeout(10000)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.error) {
    throw new Error('WhatsApp OTP delivery failed.');
  }
  return { messageId: result?.messages?.[0]?.id || null };
}
