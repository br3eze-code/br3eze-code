// src/channels/telegram.js
class TelegramChannel {
constructor(token, askEngine) {
  this.bot = new TelegramBot(token, { polling: true });
  this.askEngine = askEngine;
  
  // Add message handlers
  this.bot.onText(/\/start/, this.handleStart.bind(this));
  this.bot.onText(/\/users/, this.handleUsers.bind(this));
  this.bot.on('message', this.handleNaturalLanguage.bind(this));
}

async handleNaturalLanguage(msg) {
  if (msg.text?.startsWith('/')) return; // Skip commands
  
  const result = await this.askEngine.processQuery(msg.text);
  
  if (result.command) {
    // Execute command and respond
    this.bot.sendMessage(msg.chat.id, `Executing: ${result.command}`);
  } else if (result.error) {
    this.bot.sendMessage(msg.chat.id, `⚠️ ${result.message}`);
  }
}
     
      request: {
        url: 'https://api.telegram.org',
        timeout: 30000,
        agent: new https.Agent({
          keepAlive: true,
          maxSockets: 5     
        })
      }
    });
    
   
    this.messageCache = new Map();
    this.cacheCleanup = setInterval(() => this.clearOldCache(), 60000);
    
  
    this.bot.setMaxListeners(20);
  }
  
  clearOldCache() {
    const now = Date.now();
    for (const [key, value] of this.messageCache.entries()) {
      if (now - value.timestamp > 300000) { // 5 min expiry
        this.messageCache.delete(key);
      }
    }
  }
  
  destroy() {
    clearInterval(this.cacheCleanup);
    this.bot.stopPolling();
    this.bot.removeAllListeners();
  }
}
