import { Logger } from '../utils/logger.js';
import { ToolNotFoundError, SkillDisabledError } from './tool-registry.js';

/**
 * Agent Runtime
 * Orchestrates tool execution, memory management, and provider calls
 * Implements the OpenClaw execution loop
 */


class AgentRuntime {
  constructor(options) {
    this.toolRegistry = options.toolRegistry;
    this.sessionManager = options.sessionManager;
    this.memoryStore = options.memoryStore;
    this.providerManager = options.providerManager;
    this.safetyEnvelope = options.safetyEnvelope;
    
    this.logger = new Logger('AgentRuntime');
    this.maxIterations = options.maxIterations || 10;
  }
  
  /**
   * Main execution loop
   */
  async execute(frame) {
    const sessionId = this.sessionManager.getSessionId(frame);
    
    this.logger.debug(`Executing for session: ${sessionId}`);
    
    // Load session history
    const history = await this.sessionManager.load(sessionId);
    
    // Get capability manifest (used for system prompt)
    const manifest = this.toolRegistry.getManifest();

    // Get LLM-formatted tools (OpenAI function-calling schema when available)
    const llmTools = typeof this.toolRegistry.getToolsForLLM === 'function'
      ? this.toolRegistry.getToolsForLLM()
      : manifest.tools;

    // Build system prompt with capabilities
    const systemPrompt = this.buildSystemPrompt(manifest);
    
    // Prepare conversation
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: frame.content }
    ];
    
    // Execution loop with tool calling
    let iteration = 0;
    let finalResponse = null;
    
    while (iteration < this.maxIterations) {
      iteration++;
      
      // Call provider with OpenAI-compatible tool schema
      const response = await this.providerManager.execute(conversation, llmTools);
      
      // Check for tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls
        conversation.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls
        });
        
        // Execute tools
        const toolResults = await this.executeTools(response.toolCalls, frame);
        
        // Add tool results to conversation
        for (const result of toolResults) {
          conversation.push({
            role: 'tool',
            toolCallId: result.toolCallId,
            content: JSON.stringify(result.result)
          });
        }
        
        // Continue loop for final response
        continue;
      }
      
      // No tool calls - we have final response
      finalResponse = response.content;
      conversation.push({
        role: 'assistant',
        content: finalResponse
      });
      break;
    }
    
    // Save updated session
    await this.sessionManager.save(sessionId, conversation.slice(-20)); // Keep last 20 messages
    
    // Persist to memory store for long-term recall
    await this.memoryStore.append(sessionId, {
      timestamp: Date.now(),
      input: frame.content,
      output: finalResponse,
      toolsUsed: conversation.filter(m => m.role === 'tool').length
    });
    
    return {
      response: finalResponse,
      sessionId,
      iterations: iteration,
      toolsUsed: conversation.filter(m => m.role === 'tool').map(m => m.toolCallId)
    };
  }
  
  /**
   * Execute a single tool directly (for CLI/commands)
   */
  async executeTool(toolName, params, options = {}) {
    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) throw new ToolNotFoundError(toolName);
    
    // Validate parameters
    const validation = this.validateParams(tool.schema?.parameters, params);
    if (!validation.valid) {
      throw new Error(`Parameter validation failed: ${validation.error}`);
    }
    
    // Check safety envelope
    if (!this.safetyEnvelope.checkToolExecution(toolName, params)) {
      throw new Error(`Tool execution blocked by safety envelope: ${toolName}`);
    }
    
    // Route through registry so metrics + disabled-skill guard apply
    this.logger.info(`Executing tool: ${toolName}`, params);
    return this.toolRegistry.execute(toolName, params, options);
  }
  
  /**
   * Execute multiple tool calls
   */
  async executeTools(toolCalls, frame) {
    const ctx = {
      sender:    frame.sender,
      channel:   frame.channel,
      sessionId: this.sessionManager.getSessionId(frame)
    };
    const results = [];
    
    for (const call of toolCalls) {
      // LLM names use __ as separator (OpenAI compat) — convert back to .
      const toolName = (call.name || '').replace(/__/g, '.');
      try {
        const tool = this.toolRegistry.getTool(toolName);
        if (!tool) {
          results.push({ toolCallId: call.id, result: { error: `Tool not found: ${toolName}` } });
          continue;
        }
        
        // Validate
        const validation = this.validateParams(tool.schema?.parameters, call.arguments);
        if (!validation.valid) {
          results.push({ toolCallId: call.id, result: { error: validation.error } });
          continue;
        }
        
        // Safety check
        if (!this.safetyEnvelope.checkToolExecution(toolName, call.arguments)) {
          results.push({ toolCallId: call.id, result: { error: 'Blocked by safety envelope' } });
          continue;
        }
        
        // Route through registry — metrics + disabled-skill guard applied
        const result = await this.toolRegistry.execute(toolName, call.arguments, ctx);
        results.push({ toolCallId: call.id, result });
        
      } catch (err) {
        this.logger.error(`Tool execution error (${toolName}):`, err.message);
        const friendly = err instanceof SkillDisabledError
          ? `Skill is currently disabled: ${err.skillName}`
          : err.message;
        results.push({ toolCallId: call.id, result: { error: friendly } });
      }
    }
    
    return results;
  }
  
  /**
   * Build system prompt with capability manifest
   */
  buildSystemPrompt(manifest) {
    const toolDescriptions = (manifest?.tools || []).map(tool => {
      // Parameters can be an array or JSON-schema object — handle both
      const paramDefs = Array.isArray(tool.parameters)
        ? tool.parameters
        : Object.entries(tool.parameters?.properties || {}).map(([name, def]) => ({
            name, type: def.type, required: (tool.parameters.required || []).includes(name)
          }));
      const params = paramDefs
        .map(p => `${p.name}${p.required ? '' : '?'}: ${p.type || 'any'}`)
        .join(', ');
      return `- ${tool.name}(${params}): ${tool.description || ''}`;
    }).join('\n');

    return `You are AgentOS, an AI assistant that helps manage systems through available tools.

Available tools:
${toolDescriptions}

When you need to use a tool, respond with a tool call. Otherwise, respond naturally.
Be concise and helpful. If a tool execution fails, explain the error to the user.`;
  }
  
  /**
   * Validate parameters against schema
   */
  validateParams(schema, params = {}) {
    // Handle missing or empty schema gracefully
    if (!schema) return { valid: true };

    // Normalise: accept both array form and JSON-schema object form
    let paramList = [];
    if (Array.isArray(schema)) {
      paramList = schema;
    } else if (schema.properties) {
      const required = schema.required || [];
      paramList = Object.entries(schema.properties).map(([name, def]) => ({
        name,
        type:     def.type,
        required: required.includes(name),
      }));
    } else {
      return { valid: true }; // unknown schema shape — skip validation
    }

    for (const param of paramList) {
      if (param.required && !(param.name in params)) {
        return { valid: false, error: `Missing required parameter: ${param.name}` };
      }
      if (param.name in params) {
        const value        = params[param.name];
        const expectedType = param.type;
        if (expectedType === 'string'  && typeof value !== 'string')
          return { valid: false, error: `Parameter ${param.name} must be a string` };
        if (expectedType === 'number'  && typeof value !== 'number')
          return { valid: false, error: `Parameter ${param.name} must be a number` };
        if (expectedType === 'boolean' && typeof value !== 'boolean')
          return { valid: false, error: `Parameter ${param.name} must be a boolean` };
      }
    }
    return { valid: true };
  }
}

export default  { AgentRuntime };

