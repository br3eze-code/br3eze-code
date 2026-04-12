// src/core/ask-engine.js
class AskEngine {
  async processQuery(query) {
    const fallbackCommands = {
      'who is active': '/users',
      'active users': '/users',
      'show users': '/users',
      'dashboard': '/stats'
    };
    
    // Try exact match first
    const normalized = query.toLowerCase().trim();
    if (fallbackCommands[normalized]) {
      return this.executeCommand(fallbackCommands[normalized]);
    }
    
    // Then try AI
    try {
      return await this.geminiProcess(query);
    } catch (e) {
      return { error: 'AI unavailable', fallback: '/menu' };
    }
  }
}
