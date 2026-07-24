import EventEmitter from 'events';

// src/core/eventBus.js


class AgentBus extends EventEmitter { }
const eventBus = new AgentBus();

export default eventBus;
