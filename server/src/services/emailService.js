import nodemailer from 'nodemailer';

let transporter = null;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required email configuration: ${name}`);
  return value;
}

function getTransporter() {
  if (transporter) return transporter;

  const host = required('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '') === 'true' || port === 465;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: required('SMTP_USER'),
      pass: required('SMTP_PASS')
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100
  });

  return transporter;
}

export async function sendOtpEmail({ to, code, expiresMinutes = 10 }) {
  const from = required('EMAIL_FROM');
  const appName = process.env.EMAIL_APP_NAME || 'Power Connect';

  return getTransporter().sendMail({
    from,
    to,
    subject: `${appName} verification code`,
    text: `Your ${appName} verification code is ${code}. It expires in ${expiresMinutes} minutes. If you did not request this code, you can ignore this email.`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif"><h2>${appName}</h2><p>Your verification code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in ${expiresMinutes} minutes.</p><p>If you did not request this code, you can ignore this email.</p></body></html>`
  });
}

export async function verifyEmailTransport() {
  await getTransporter().verify();
  return true;
}
