import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderCode, renderDiff } from '../../src/cli/terminal-renderer.js';
import { navigationCommand } from '../../src/cli/terminal-session.js';

const outputs = (fn) => { const chunks = []; fn({ write: (x) => chunks.push(String(x)) }); return chunks.join(''); };

test('Phase 9 markdown renderer handles headings, emphasis, code and lists', () => {
    const value = renderMarkdown('# Title\n**bold** `code`\n- item', { color: false });
    assert.match(value, /Title/);
    assert.match(value, /bold/);
    assert.match(value, /code/);
    assert.match(value, /• item/);
});

test('Phase 9 code renderer preserves source exactly', () => {
    assert.equal(renderCode('const x = 1;\n', { language: 'js', color: false }), 'const x = 1;\n');
});

test('Phase 9 diff renderer preserves diff content', () => {
    assert.equal(renderDiff('+added\n-removed', { color: false }), '+added\n-removed');
});

test('Phase 9 navigation stays in the UI boundary', () => {
    assert.deepEqual(navigationCommand('/help'), { action: 'help' });
    assert.deepEqual(navigationCommand('/clear'), { action: 'clear' });
    assert.deepEqual(navigationCommand('/cancel'), { action: 'cancel' });
});

test('Phase 9 renderer writes agent results without orchestration', () => {
    const output = outputs((out) => {
        const { result } = { result: renderMarkdown('## Done', { color: false }) };
        out.write(result);
    });
    assert.equal(output, '## Done');
});
