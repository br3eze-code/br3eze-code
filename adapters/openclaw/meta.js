// File: adapters/openclaw/meta.js
import { AgentOS } from '../../skills/agentos/index.js'

// OpenClaw skill format: https://docs.openclaw.org/skills
export default function agentOSAdapter(agentosInstance) {
  const skills = []
  const tools = AgentOS.getTools()

  for (const [name, spec] of Object.entries(tools)) {
    skills.push({
      name,
      description: spec.description,
      parameters: spec.parameters,
      risk: spec.risk,
      execute: async (args, context) => {
        const ctx = {
          userId: context.user_id || 'openclaw_user',
          workspace: context.workspace || '/data/agentos'
        }
        return await agentosInstance.execute(name, args, ctx)
      }
    })
  }

  return {
    id: 'agentos',
    name: 'AgentOS Business Suite',
    version: '1.0.0',
    description: '27 skills: tours, accounting, unions, permits, tax, merch, CRM. Full music/construction ops.',
    author: 'AgentOS',
    skills
  }
}
