import { EventEmitter } from 'node:events';
import { createApprovalPrompt } from '../../src/cli/approval-prompt.js';

test('Phase 9 approval prompt accepts yes', async () => {
    const input = new EventEmitter();
    const output = { write() {} };
    const promise = createApprovalPrompt({ input, output, color: false })({ action: 'restart service' });
    input.emit('data', 'yes\n');
    expect(await promise).toBe(true);
});

test('Phase 9 approval prompt rejects no', async () => {
    const input = new EventEmitter();
    const output = { write() {} };
    const promise = createApprovalPrompt({ input, output, color: false })({ action: 'delete resource' });
    input.emit('data', 'no\n');
    expect(await promise).toBe(false);
});

test('Phase 9 approval prompt aborts safely', async () => {
    const input = new EventEmitter();
    const output = { write() {} };
    const controller = new AbortController();
    const promise = createApprovalPrompt({ input, output, color: false })({ action: 'write file', signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await expect(promise).rejects.toThrow('cancelled');
});
