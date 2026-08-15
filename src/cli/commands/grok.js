import readline from 'node:readline';
import { XAIProvider } from '../../core/llm/providers/XAIProvider.js';

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.text) console.log(result.text);
  if (result.calls?.length) console.log(`\nTool calls requested: ${result.calls.map(call => call.name).join(', ')}`);
}

export default (program) => {
  program
    .command('grok [prompt]')
    .description('Chat with Grok through the xAI API')
    .option('--model <model>', 'Grok model alias', process.env.XAI_MODEL || 'grok-4.6')
    .option('--system <instruction>', 'System instruction', 'You are AgentOS, a careful operational assistant.')
    .option('--repl', 'Start an interactive Grok bot session')
    .option('--json', 'Print structured JSON output')
    .action(async (prompt, options) => {
      const provider = new XAIProvider({ model: options.model });
      const messages = [{ role: 'system', content: options.system }];
      const ask = async (text) => {
        messages.push({ role: 'user', content: text });
        const result = await provider.generate(messages);
        messages.push({ role: 'assistant', content: result.text });
        printResult(result, options.json);
      };

      try {
        if (prompt && !options.repl) {
          await ask(prompt);
          return;
        }
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'grok> ' });
        console.log(`Grok ${options.model} ready. Type /exit to quit.`);
        rl.prompt();
        for await (const line of rl) {
          const text = line.trim();
          if (!text) { rl.prompt(); continue; }
          if (text === '/exit' || text === '/quit') { rl.close(); break; }
          await ask(text);
          rl.prompt();
        }
      } catch (error) {
        console.error(`Grok unavailable: ${error.message}`);
        process.exitCode = 1;
      }
    });
};
