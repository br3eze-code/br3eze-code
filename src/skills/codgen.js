// skills/codegen.js
import { GoogleGenerativeAI } from '@google/generative-ai';

export const codegen = {
  name: "codegen",
  description: "Generate MikroTik RouterOS .rsc code from natural language using Gemini 2.5",
  parameters: {
    type: "object",
    properties: {
      prompt: { 
        type: "string", 
        description: "What RouterOS config to generate. E.g. 'block youtube after 8pm', 'rate limit user john to 2M'" 
      }
    },
    required: ["prompt"]
  },
  
  run: async ({ prompt }, { mikrotik, gemini, logger }) => {
    logger.info(`Codegen skill: ${prompt}`);
    
    // Get current router context to help Gemini
    const context = await mikrotik.executeTool('system.stats');
    const version = context['version'] || '7.x';
    
    const systemPrompt = `You are a MikroTik RouterOS ${version} expert. 
Output ONLY valid .rsc code. No explanations, no markdown, no comments unless requested.
Use RouterOS v7 syntax. Be precise with paths like /ip/firewall/filter.
Current router board: ${context['board-name']}`;

    const response = await gemini.generate({
      model: "gemini-2.5-flash",
      system: systemPrompt,
      prompt: `Generate RouterOS code for: ${prompt}`
    });
    
    const code = response.text.trim();
    
    // Basic validation - must start with /
    if (!code.startsWith('/')) {
      throw new Error('Generated code invalid - must be RouterOS commands');
    }
    
    return {
      success: true,
      prompt: prompt,
      code: code,
      warning: "Review before executing on production router"
    };
  }
}
