/**
 * EventBus - High-performance event system with priority queues and filtering
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.priorities = new Map();
    this.middleware = [];
    this.metrics = {
      eventsEmitted: 0,
      eventsHandled: 0,
    };
  }

  on(event, handler, priority = 5) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
      this.priorities.set(event, []);
    }

    const handlers = this.listeners.get(event);
    const priorities = this.priorities.get(event);

    // Insert based on priority (higher = earlier)
    const insertIndex = priorities.findIndex(p => p < priority);
    const index = insertIndex === -1 ? handlers.length : insertIndex;

    handlers.splice(index, 0, handler);
    priorities.splice(index, 0, priority);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  once(event, handler, priority = 5) {
    const onceWrapper = data => {
      this.off(event, onceWrapper);
      handler(data);
    };
    return this.on(event, onceWrapper, priority);
  }

  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
      this.priorities.get(event).splice(index, 1);
    }
  }

  async emit(event, data) {
    this.metrics.eventsEmitted++;

    // Run middleware
    let processedData = data;
    for (const mw of this.middleware) {
      processedData = await mw(event, processedData);
      if (processedData === null) return; // Cancelled by middleware
    }

    const handlers = this.listeners.get(event) || [];
    const wildcardHandlers = this.listeners.get('*') || [];

    // Execute handlers in priority order
    const allHandlers = [
      ...handlers.map(h => ({ handler: h, type: 'specific' })),
      ...wildcardHandlers.map(h => ({ handler: h, type: 'wildcard' })),
    ];

    for (const { handler } of allHandlers) {
      try {
        await handler(processedData);
        this.metrics.eventsHandled++;
      } catch (error) {
        console.error(`[EventBus] Handler error for ${event}:`, error);
        this.emit('bus:error', { event, error, data: processedData });
      }
    }
  }

  use(middleware) {
    this.middleware.push(middleware);
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

export default EventBus;
