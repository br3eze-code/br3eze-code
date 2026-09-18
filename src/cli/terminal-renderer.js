const ANSI = Object.freeze({
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m'
});

export function renderMarkdown(input, { color = true } = {}) {
    const text = String(input ?? '').replace(/\r\n/g, '\n');
    if (!color) return text.replace(/^\s*[-*]\s+/gm, '• ');
    return text
        .replace(/^```([^\n]*)\n([\s\S]*?)\n```/gm, (_m, lang, code) => `${ANSI.dim}[${lang || 'code'}]${ANSI.reset}\n${code}`)
        .replace(/^#{1,6}\s+(.+)$/gm, (_m, title) => `${ANSI.bold}${title}${ANSI.reset}`)
        .replace(/\*\*([^*]+)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`)
        .replace(/`([^`]+)`/g, `${ANSI.cyan}$1${ANSI.reset}`)
        .replace(/^\s*[-*]\s+/gm, '• ');
}

export function renderCode(code, { language = '', color = true } = {}) {
    const body = String(code ?? '');
    return color && language ? `${ANSI.dim}[${language}]${ANSI.reset}\n${body}` : body;
}

export function renderDiff(diff, { color = true } = {}) {
    const lines = String(diff ?? '').replace(/\r\n/g, '\n').split('\n');
    return lines.map((line) => {
        if (!color) return line;
        if (line.startsWith('+') && !line.startsWith('+++')) return `${ANSI.green}${line}${ANSI.reset}`;
        if (line.startsWith('-') && !line.startsWith('---')) return `${ANSI.red}${line}${ANSI.reset}`;
        if (line.startsWith('@@')) return `${ANSI.cyan}${line}${ANSI.reset}`;
        return line;
    }).join('\n');
}

export function renderAgentResult(result, { json = false, output = process.stdout, color = true } = {}) {
    if (json) return output.write(`${JSON.stringify(result, null, 2)}\n`);
    const value = typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result ?? result, null, 2);
    return output.write(`${renderMarkdown(value, { color })}\n`);
}

export function renderEvent(event, { output = process.stdout, color = true } = {}) {
    if (!event) return;
    const type = String(event.type || 'event');
    const message = event.message ?? event.delta ?? event.output;
    if (type === 'message.delta' || type === 'text') return output.write(String(message ?? ''));
    if (type.includes('failed') || type.includes('error')) return output.write(`${color ? ANSI.red : ''}[${type}]${color ? ANSI.reset : ''} ${message ?? ''}\n`);
    if (type === 'verification.completed') return output.write(`${color ? ANSI.green : ''}✓${color ? ANSI.reset : ''} verification ${event.success === false ? 'failed' : 'completed'}\n`);
    return output.write(`${color ? ANSI.dim : ''}[${type}]${color ? ANSI.reset : ''}${message ? ` ${message}` : ''}\n`);
}
