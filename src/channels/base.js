import { EventEmitter } from 'node:events';
import { normalizeNavigation } from '../core/interaction/navigation.js';

/**
 * Base Channel

 */


class BaseChannel extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'base';
    this.connected = false;
    this.options = options;
  }
  
  /**
   * Initialize and connect to channel
   */
  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }
  
  /**
   * Disconnect from channel
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }
  
  /**
   * Send message to recipient
   */
  async send(recipient, message) {
    throw new Error('send() must be implemented by subclass');
  }
  
  /**
   * Format message for channel-specific rendering
   */
  formatMessage(message) {
    if (typeof message === 'string') {
      return { text: message };
    }
    return message;
  }
  
  /**
   * Return a stable, channel-scoped user identifier.
   * Channel adapters should provide metadata.userId when the platform
   * distinguishes a user from the conversation recipient.
   */
  getUserIdentifier(event = {}) {
    const metadata = event.metadata || {};
    const rawUserId = metadata.userId ?? event.userId ?? event.senderId ?? event.sender;
    return rawUserId === undefined || rawUserId === null || rawUserId === ''
      ? null
      : `${this.name}:${String(rawUserId)}`;
  }

  /**
   * Normalize identity without erasing channel-specific identifiers.
   */
  getChannelIdentity(event = {}) {
    const metadata = event.metadata || {};
    const rawConversationId = metadata.conversationId ?? event.conversationId ?? event.sender;
    return {
      channel: this.name,
      userId: this.getUserIdentifier(event),
      conversationId: rawConversationId === undefined || rawConversationId === null || rawConversationId === ''
        ? null
        : `${this.name}:${String(rawConversationId)}`,
      rawUserId: metadata.userId ?? event.userId ?? event.senderId ?? null,
      rawConversationId: rawConversationId ?? null,
    };
  }

  /**
   * Normalize channel-native navigation input into a shared action.
   */
  normalizeNavigation(input) {
    return normalizeNavigation(input);
  }

  /**
   * Generate frame from channel-specific event
   */
  createFrame(event) {
    const metadata = event.metadata || {};
    return {
      id: this.generateId(),
      sender: event.sender,
      senderName: event.senderName || event.sender,
      channel: this.name,
      content: event.content,
      timestamp: Date.now(),
      isDM: event.isDM !== undefined ? event.isDM : true,
      identity: this.getChannelIdentity(event),
      metadata
    };
  }
  
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export { BaseChannel };