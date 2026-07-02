// skills/codegen.js
const codegen = {
  name: 'codegen',
  description: 'Generate RouterOS .rsc code from natural language',
  parameters: {
    prompt: "string - what to generate, e.g. 'block youtube after 8pm'",
  },
  run: async ({ prompt }, ctx = {}) => {
    const gemini = ctx.agent?.gemini || global.gemini;
    if (!gemini) throw new Error('AI provider (Gemini) not initialized');

    const response = await gemini.generate({
      system: 'You are a MikroTik RouterOS expert. Output only valid .rsc code.',
      prompt,
    });
    return response.text;
  },
};

module.exports = { codegen };
