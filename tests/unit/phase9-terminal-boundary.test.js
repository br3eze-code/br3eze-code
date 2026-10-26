import { renderMarkdown, renderCode, renderDiff } from '../../src/cli/terminal-renderer.js';
import { navigationCommand } from '../../src/cli/terminal-session.js';

const outputs = (fn) => { const chunks = []; fn({ write: (x) => chunks.push(String(x)) }); return chunks.join(''); };

test('Phase 9 markdown renderer handles headings, emphasis, code and lists', () => {
    const value = renderMarkdown('# Title\n**bold** `code`\n- item', { color: false });
    expect(value).toMatch(/Title/);
    expect(value).toMatch(/bold/);
    expect(value).toMatch(/code/);
    expect(value).toMatch(/• item/);
});

test('Phase 9 code renderer preserves source exactly', () => {
    expect(renderCode('const x = 1;\n', { language: 'js', color: false })).toBe('const x = 1;\n');
});

test('Phase 9 diff renderer preserves diff content', () => {
    expect(renderDiff('+added\n-removed', { color: false })).toBe('+added\n-removed');
});

test('Phase 9 navigation stays in the UI boundary', () => {
    expect(navigationCommand('/help')).toEqual({ action: 'help' });
    expect(navigationCommand('/clear')).toEqual({ action: 'clear' });
    expect(navigationCommand('/cancel')).toEqual({ action: 'cancel' });
});

test('Phase 9 renderer writes agent results without orchestration', () => {
    const output = outputs((out) => {
        const { result } = { result: renderMarkdown('## Done', { color: false }) };
        out.write(result);
    });
    expect(output).toBe('## Done');
});
