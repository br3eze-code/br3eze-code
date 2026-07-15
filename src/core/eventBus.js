// src/core/eventBus.js

import EventEmitter from 'events';

class AgentBus extends EventEmitter { }
const eventBus = new AgentBus();

export default eventBus;