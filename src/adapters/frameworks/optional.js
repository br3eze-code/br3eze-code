import { AgentOSFrameworkAdapter } from './AgentOSFrameworkAdapter.js';

function method(module, names) {
  for (const name of names) if (typeof module?.[name] === 'function') return module[name].bind(module);
  return null;
}

function bridge(id, module, mapping = {}) {
  const call = (key, fallbackNames, ...args) => {
    const fn = mapping[key] ? method(module, [mapping[key]]) : method(module, fallbackNames);
    if (!fn) throw new Error(`FRAMEWORK_OPERATION_UNAVAILABLE:${id}:${key}`);
    return fn(...args);
  };
  return new AgentOSFrameworkAdapter({ id, factory: {
    createAgent: (spec) => call('createAgent', ['createAgent', 'create_agent'], spec),
    runAgent: (agent, input, context) => call('runAgent', ['runAgent', 'run_agent', 'invoke'], agent, input, context),
    handoff: (agent, target, context) => call('handoff', ['handoff'], agent, target, context),
    createChild: (agent, spec, context) => call('createChild', ['createChild', 'create_child'], agent, spec, context),
    defineWorkflow: (spec) => call('defineWorkflow', ['defineWorkflow', 'define_workflow', 'compile'], spec),
    runWorkflow: (workflow, input, context) => call('runWorkflow', ['runWorkflow', 'run_workflow', 'invoke'], workflow, input, context),
    resumeWorkflow: (checkpoint, context) => call('resumeWorkflow', ['resumeWorkflow', 'resume_workflow'], checkpoint, context),
    registerTool: (tool) => call('registerTool', ['registerTool', 'register_tool'], tool),
    executeTool: (tool, input, context) => call('executeTool', ['executeTool', 'execute_tool'], tool, input, context),
    checkGuardrail: (input, context) => call('checkGuardrail', ['checkGuardrail', 'check_guardrail'], input, context),
    readMemory: (query, context) => call('readMemory', ['readMemory', 'read_memory'], query, context),
    writeMemory: (entry, context) => call('writeMemory', ['writeMemory', 'write_memory'], entry, context),
    readTrace: (executionId, context) => call('readTrace', ['readTrace', 'read_trace'], executionId, context),
    evaluate: (execution, expected, context) => call('evaluate', ['evaluate'], execution, expected, context)
  }});
}

export const createOpenAIAgentsAdapter = (module) => bridge('openai-agents', module);
export const createMicrosoftAgentFrameworkAdapter = (module) => bridge('microsoft-agent-framework', module);
export const createLangGraphAdapter = (module) => bridge('langgraph', module);
export const createCrewAIAdapter = (module) => bridge('crewai', module);
export const createAutoGenAdapter = (module) => bridge('autogen', module);

export async function loadOptionalAdapter({ id, moduleName, create }) {
  try {
    const module = await import(moduleName);
    return create(module);
  } catch (error) {
    const wrapped = new Error(`OPTIONAL_FRAMEWORK_UNAVAILABLE:${id}`);
    wrapped.code = 'OPTIONAL_FRAMEWORK_UNAVAILABLE';
    wrapped.cause = error;
    throw wrapped;
  }
}
