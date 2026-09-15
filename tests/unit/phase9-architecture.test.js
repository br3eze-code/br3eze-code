import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const askCommand = fs.readFileSync(path.join(root, 'src/cli/commands/ask.js'), 'utf8');

test('Phase 9 terminal command does not compose domain services', () => {
    expect(askCommand).not.toMatch(/core\/(mikrotik|database|financial|universal-billing|discovery|memory)\b/);
    expect(askCommand).not.toMatch(/LLMCoordinator/);
    expect(askCommand).not.toMatch(/new\s+AskEngine/);
    expect(askCommand).toMatch(/createAskClient/);
});

test('Phase 9 terminal renderer is separate from orchestration', () => {
    const renderer = fs.readFileSync(path.join(root, 'src/cli/terminal-renderer.js'), 'utf8');
    expect(renderer).toMatch(/renderMarkdown/);
    expect(renderer).toMatch(/renderCode/);
    expect(renderer).toMatch(/renderDiff/);
    expect(renderer).toMatch(/renderEvent/);
    expect(renderer).not.toMatch(/AskEngine/);
});
