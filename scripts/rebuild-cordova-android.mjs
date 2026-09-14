import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    windowsHide: false
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The Android platform directory is generated state. Recreate it so removed
// legacy Cordova plugins cannot survive from a previous prepare/build.
const remove = spawnSync(command, ['cordova', 'platform', 'rm', 'android', '--nosave'], {
  stdio: 'inherit',
  shell: false,
  windowsHide: false
});

if (remove.error) throw remove.error;

// cordova platform rm returns non-zero when android was not installed; that is
// harmless because the next command creates a clean platform from config.xml.
run(['cordova', 'platform', 'add', 'android@15.0.0', '--nosave']);
