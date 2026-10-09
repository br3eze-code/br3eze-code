export function createApprovalPrompt({ input = process.stdin, output = process.stdout, color = true } = {}) {
    return async function requestApproval({ action, tool, reason, signal } = {}) {
        if (signal?.aborted) throw signal.reason || new Error('Operation cancelled by user');
        const label = tool ? `${tool}: ` : '';
        output.write(`\n${color ? '\x1b[33m' : ''}Approval required${color ? '\x1b[0m' : ''}\n${label}${action || 'proposed action'}${reason ? `\nReason: ${reason}` : ''}\nApprove? [y/N] `);
        input.setEncoding?.('utf8');
        return new Promise((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                input.removeListener?.('data', onData);
                signal?.removeEventListener?.('abort', onAbort);
            };
            const finish = (value, error) => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error) reject(error); else resolve(value);
            };
            const onData = (chunk) => {
                const answer = String(chunk).trim().toLowerCase();
                if (!answer) return finish(false);
                if (['y', 'yes'].includes(answer)) return finish(true);
                if (['n', 'no'].includes(answer)) return finish(false);
            };
            const onAbort = () => finish(false, signal.reason || new Error('Operation cancelled by user'));
            input.once?.('data', onData);
            signal?.addEventListener?.('abort', onAbort, { once: true });
        });
    };
}
