export class Runnable {
  async invoke(input, config = {}) {
    return input;
  }

  pipe(next) {
    return new RunnableSequence([this, next]);
  }

  withConfig(config = {}) {
    const source = this;
    return new Runnable({
      async invoke(input, runtime = {}) {
        return source.invoke(input, { ...config, ...runtime });
      }
    });
  }
}

export class RunnableLambda extends Runnable {
  constructor(fn) {
    super();
    if (typeof fn !== 'function') throw new TypeError('RunnableLambda requires a function');
    this.fn = fn;
  }

  invoke(input, config = {}) {
    return this.fn(input, config);
  }
}

export class RunnableSequence extends Runnable {
  constructor(steps = []) {
    super();
    this.steps = steps.flatMap((step) => step instanceof Runnable ? [step] : [new RunnableLambda(step)]);
  }

  async invoke(input, config = {}) {
    let value = input;
    for (const step of this.steps) value = await step.invoke(value, config);
    return value;
  }
}

export class RunnableMap extends Runnable {
  constructor(runnables = {}) {
    super();
    this.runnables = Object.fromEntries(Object.entries(runnables).map(([key, value]) => [key, value instanceof Runnable ? value : new RunnableLambda(value)]));
  }

  async invoke(input, config = {}) {
    const entries = await Promise.all(Object.entries(this.runnables).map(async ([key, runnable]) => [key, await runnable.invoke(input, config)]));
    return Object.fromEntries(entries);
  }
}

export class PromptTemplate extends Runnable {
  constructor(template, { inputVariables = null } = {}) {
    super();
    this.template = String(template);
    this.inputVariables = inputVariables || [...this.template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]);
  }

  format(values = {}) {
    for (const name of this.inputVariables) {
      if (values[name] === undefined) throw new Error(`Missing prompt variable: ${name}`);
    }
    return this.inputVariables.reduce((text, name) => text.replaceAll(`{${name}}`, String(values[name])), this.template);
  }

  invoke(values = {}) {
    return this.format(values);
  }
}

export class StructuredTool extends Runnable {
  constructor({ name, description, schema = {}, func }) {
    super();
    if (!name || typeof func !== 'function') throw new TypeError('StructuredTool requires name and func');
    this.name = name;
    this.description = description || name;
    this.schema = schema;
    this.func = func;
  }

  invoke(input, config = {}) {
    return this.func(input, config);
  }
}

export class StateGraph {
  constructor({ channels = {} } = {}) {
    this.channels = channels;
    this.nodes = new Map();
    this.edges = new Map();
    this.entry = null;
  }

  addNode(name, runnable) {
    this.nodes.set(name, runnable instanceof Runnable ? runnable : new RunnableLambda(runnable));
    return this;
  }

  addEdge(from, to) {
    this.edges.set(from, to);
    return this;
  }

  setEntryPoint(name) {
    this.entry = name;
    return this;
  }

  compile() {
    if (!this.entry || !this.nodes.has(this.entry)) throw new Error('StateGraph requires an entry point');
    const graph = this;
    return new RunnableLambda(async (state, config = {}) => {
      let node = graph.entry;
      let current = state;
      const visited = new Set();
      while (node) {
        if (visited.has(node)) throw new Error(`StateGraph cycle detected at ${node}`);
        visited.add(node);
        current = await graph.nodes.get(node).invoke(current, config);
        node = graph.edges.get(node) || null;
      }
      return current;
    });
  }
}

export function createAgentChain({ prompt, model, tools = [], context = {} } = {}) {
  const promptStep = prompt instanceof Runnable ? prompt : new PromptTemplate(prompt || '{input}');
  const modelStep = model instanceof Runnable ? model : new RunnableLambda((messages, config) => model.generate(messages, tools, { ...config, context }));
  return new RunnableSequence([new RunnableLambda((input) => ({ ...input, context })), promptStep, modelStep]);
}

export default { Runnable, RunnableLambda, RunnableSequence, RunnableMap, PromptTemplate, StructuredTool, StateGraph, createAgentChain };
