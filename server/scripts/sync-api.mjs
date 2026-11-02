import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const copies = [
  {
    source: resolve(here, '../../api/chat/otp'),
    target: resolve(here, '../api/chat/otp'),
    label: 'api/chat/otp',
    directory: true,
  },
  {
    source: resolve(here, '../../src/api/routes/firebase-data-session.js'),
    target: resolve(here, '../src/api/routes/firebase-data-session.js'),
    label: 'src/api/routes/firebase-data-session.js',
    directory: false,
  },
  {
    source: resolve(here, '../../src/adapters/auth/supabase.js'),
    target: resolve(here, '../src/adapters/auth/supabase.js'),
    label: 'src/adapters/auth/supabase.js',
    directory: false,
  },
];

for (const item of copies) {
  if (!existsSync(item.source)) {
    throw new Error('Canonical source is missing: ' + item.source);
  }
  mkdirSync(dirname(item.target), { recursive: true });
  if (item.directory) rmSync(item.target, { recursive: true, force: true });
  cpSync(item.source, item.target, { recursive: item.directory, force: true });
}

process.stdout.write('Synced canonical OTP, Supabase auth, and Firebase data-session adapters into the Firebase Functions package.\n');
