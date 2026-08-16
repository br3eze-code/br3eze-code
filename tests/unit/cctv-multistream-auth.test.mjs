import assert from 'node:assert/strict';
import { test } from 'node:test';
import CctvSkill from '../../src/skills/cctv/index.js';

function makeSkill() {
  const workspace = { dahua_devices: { nvr1: { host: 'nvr.local' } } };
  const skill = new CctvSkill({ workspace }, console, workspace);
  skill.adapters.set('dahua', {
    async execute(tool, args) {
      if (tool === 'dahua.device.channels') return [{ channel: 1, name: 'Front Door', enabled: true }, { channel: 2, name: 'Loading Bay', enabled: true }];
      if (tool === 'dahua.stream.url') return { device: args.device, channel: args.channel, main: `rtsp://nvr/${args.channel}?subtype=0`, sub: `rtsp://nvr/${args.channel}?subtype=1` };
      throw new Error(`Unexpected tool ${tool}`);
    }
  });
  return skill;
}

test('cctv.stream.multi fails closed without an authenticated identity', async () => {
  const result = await makeSkill().execute('cctv.stream.multi', { device: 'nvr1', channels: [1] });
  assert.equal(result.authorizationRequired, true);
  assert.equal(result.code, 'AUTHENTICATION_REQUIRED');
});

test('cctv.stream.multi accepts an explicit permission grant', async () => {
  const result = await makeSkill().execute('cctv.stream.multi', { device: 'nvr1', channels: [1, 2] }, {
    userId: 'user-1',
    permissions: ['cctv.stream.multi']
  });
  assert.deepEqual(result.channels.map(({ channel }) => channel), [1, 2]);
});

test('cctv.stream.multi delegates authorization callbacks and denies rejected requests', async () => {
  let requested;
  const result = await makeSkill().execute('cctv.stream.multi', { device: 'nvr1', channels: [1] }, {
    userId: 'user-2',
    authorize: async (action, request) => {
      requested = { action, request };
      return { allowed: false, reason: 'camera scope missing' };
    }
  });
  assert.equal(requested.action, 'cctv.stream.multi');
  assert.deepEqual(requested.request.channels, [1]);
  assert.equal(result.code, 'FORBIDDEN');
  assert.equal(result.reason, 'camera scope missing');
});

test('cctv.stream.multi rejects more than 64 channels before adapter access', async () => {
  const skill = makeSkill();
  let accessed = false;
  skill.adapters.get('dahua').execute = async () => { accessed = true; return []; };
  await assert.rejects(() => skill.execute('cctv.stream.multi', {
    device: 'nvr1',
    channels: Array.from({ length: 65 }, (_, index) => index + 1)
  }, { userId: 'user-3', permissions: ['cctv.stream.multi'] }), /maximum of 64/);
  assert.equal(accessed, false);
});
