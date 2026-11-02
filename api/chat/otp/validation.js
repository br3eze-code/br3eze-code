export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function isValidOtpCode(value) {
  return /^[0-9]{6}$/.test(String(value || ''));
}

export function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s().-]/g, '');
  if (/^0[0-9]{9}$/.test(phone)) phone = '+263' + phone.slice(1);
  else if (/^263[0-9]{9}$/.test(phone)) phone = '+' + phone;
  else if (!phone.startsWith('+')) phone = '+' + phone;

  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    throw Object.assign(
      new Error('Enter a valid phone number with country code, for example +263771234567.'),
      { status: 400, code: 'INVALID_PHONE' }
    );
  }
  return phone;
}

export function isValidGraphApiVersion(value) {
  return /^v[0-9]+\.[0-9]+$/.test(String(value || '').trim());
}
