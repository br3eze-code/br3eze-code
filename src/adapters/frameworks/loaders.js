import {
  createOpenAIAgentsAdapter,
  createMicrosoftAgentFrameworkAdapter,
  createLangGraphAdapter,
  createCrewAIAdapter,
  createAutoGenAdapter,
  loadOptionalAdapter
} from './optional.js';

export const loadOpenAIAgentsAdapter = () => loadOptionalAdapter({ id: 'openai-agents', moduleName: '@openai/agents', create: createOpenAIAgentsAdapter });
export const loadMicrosoftAgentFrameworkAdapter = () => loadOptionalAdapter({ id: 'microsoft-agent-framework', moduleName: '@microsoft/agent-framework', create: createMicrosoftAgentFrameworkAdapter });
export const loadLangGraphAdapter = () => loadOptionalAdapter({ id: 'langgraph', moduleName: '@langchain/langgraph', create: createLangGraphAdapter });
export const loadCrewAIAdapter = () => loadOptionalAdapter({ id: 'crewai', moduleName: 'crewai', create: createCrewAIAdapter });
export const loadAutoGenAdapter = () => loadOptionalAdapter({ id: 'autogen', moduleName: 'autogen-agentchat', create: createAutoGenAdapter });
