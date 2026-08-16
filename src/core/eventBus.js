// src/core/eventBus.js

import { EventEmitter } from 'node:events';

class AgentBus extends EventEmitter {}
const eventBus = new AgentBus();

export default eventBus;
