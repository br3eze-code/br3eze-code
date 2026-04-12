// src/core/AgentOS.js 
class AgentOS {
  constructor(config) {
    this.id = config.id || crypto.randomUUID();
    this.skills = new SkillRegistry();
    this.memory = new MemoryManager();
    this.channels = new ChannelManager();
    this.llm = new LLMCoordinator(config.llm);
    this.telemetry = new TelemetryCollector();
  }

  async initialize() {
    await this.skills.loadFromDirectory(config.skillsPath || './skills');
    for (const channel of config.channels) {
      await this.channels.register(channel);
    }
  }
  async handleMessage(message, channel) {
    const context = await this.memory.getContext(message.userId);
    
    const intent = await this.llm.classify(message.text, this.skills.getDescriptions());
    
    const result = await this.skills.execute(intent.skill, intent.params, {
      userId: message.userId,
      channel,
      context
    });
    
    await this.memory.store(message.userId, { input: message, output: result });
    
    return result;
  }
}
