import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../api/chat/otp');
const target = resolve(here, '../api/chat/otp');

if (!existsSync(source)) {
  throw new Error('Canonical API OTP source is missing: ' + source);
}

mkdirSync(dirname(target), { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true, force: true });
process.stdout.write('Synced canonical api/chat/otp into the Firebase Functions package.\n');
