/**
 * GossipNode - Epidemic broadcast protocol for distributed state sync
 */

const PeerManager = require('./PeerManager');
const MessageRouter = require('./MessageRouter');
const VectorClock = require('./VectorClock');

class GossipNode {
    constructor(config = {}) {
        this.config = {
            nodeId: config.nodeId || this.generateNodeId(),
            gossipInterval: config.gossipInterval || 5000,
            fanout: config.fanout || 3, // Number of peers to gossip to
            maxMessageAge: config.maxMessageAge || 300000, // 5 minutes
            ...config
        };

        this.peers = new PeerManager();
        this.router = new MessageRouter();
        this.vectorClock = new VectorClock(this.config.nodeId);
        
        this.messageStore = new Map(); // Seen messages with timestamps
        this.handlers = new Map();
        
        this.gossipTimer = null;
        this.isRunning = false;
    }

    async initialize() {
        // Setup message handlers
        this.setupDefaultHandlers();
        
        // Initialize transport (WebRTC, WebSocket, etc.)
        await this.initializeTransport();
    }

    setupDefaultHandlers() {
        // Billing sync handler
        this.registerHandler('billing_sync', require('./handlers/billing_sync'));
        
        // Auth broadcast handler
        this.registerHandler('auth_broadcast', require('./handlers/auth_broadcast'));
        
        // Presence heartbeat
        this.registerHandler('presence_heartbeat', require('./handlers/presence_heartbeat'));
    }

    registerHandler(type, handler) {
        this.handlers.set(type, handler);
        handler.initialize?.(this);
    }

    async initializeTransport() {
        // Initialize based on environment
        if (typeof RTCPeerConnection !== 'undefined') {
            this.transport = new WebRTCTransport(this.config);
        } else {
            this.transport = new WebSocketTransport(this.config);
        }
        
        await this.transport.initialize();
        
        this.transport.on('message', (msg) => this.handleIncomingMessage(msg));
        this.transport.on('peer_connected', (peer) => this.peers.addPeer(peer));
        this.transport.on('peer_disconnected', (peer) => this.peers.removePeer(peer));
    }

    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.gossipTimer = setInterval(() => this.gossipRound(), this.config.gossipInterval);
        
        // Send initial presence
        this.broadcast('presence_heartbeat', {
            nodeId: this.config.nodeId,
            timestamp: Date.now(),
            capabilities: this.getCapabilities()
        });
    }

    stop() {
        this.isRunning = false;
        clearInterval(this.gossipTimer);
        this.transport?.close();
    }

    async gossipRound() {
        if (this.peers.size === 0) return;

        // Select random peers to gossip with
        const targets = this.peers.selectRandomPeers(this.config.fanout);
        
        // Get recent messages to share
        const messages = this.getRecentMessages();

        for (const peer of targets) {
            try {
                await this.transport.send(peer.id, {
                    type: 'gossip',
                    sender: this.config.nodeId,
                    vectorClock: this.vectorClock.get(),
                    messages: this.selectMessagesForPeer(peer, messages)
                });
            } catch (error) {
                this.peers.markPeerFailed(peer.id);
            }
        }
    }

    getRecentMessages() {
        const cutoff = Date.now() - this.config.maxMessageAge;
        const recent = [];
        
        for (const [id, msg] of this.messageStore) {
            if (msg.timestamp > cutoff) {
                recent.push(msg);
            } else {
                this.messageStore.delete(id); // Cleanup old messages
            }
        }
        
        return recent.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
    }

    selectMessagesForPeer(peer, messages) {
        // Filter out messages peer likely already has
        return messages.filter(msg => {
            const peerVector = peer.lastVector || {};
            return !this.vectorClock.isDescendant(peerVector, msg.vectorClock);
        });
    }

    async handleIncomingMessage(message) {
        // Update vector clock
        this.vectorClock.update(message.vectorClock);

        // Process gossip messages
        if (message.type === 'gossip' && message.messages) {
            for (const msg of message.messages) {
                await this.processMessage(msg);
            }
        }

        // Direct message handling
        if (message.type !== 'gossip') {
            await this.processMessage(message);
        }
    }

    async processMessage(message) {
        const messageId = this.generateMessageId(message);
        
        // Check if already seen
        if (this.messageStore.has(messageId)) {
            return; // Duplicate, ignore
        }

        // Store message
        this.messageStore.set(messageId, {
            ...message,
            receivedAt: Date.now(),
            hops: (message.hops || 0) + 1
        });

        // Route to handler
        const handler = this.handlers.get(message.type);
        if (handler) {
            try {
                await handler.handle(message, this);
            } catch (error) {
                console.error(`[GossipNode] Handler error for ${message.type}:`, error);
            }
        }

        // Emit to local subscribers
        this.emit('gossip:message', message);

        // Forward if hops allow
        if (message.maxHops && message.hops < message.maxHops) {
            this.forwardMessage(message);
        }
    }

    forwardMessage(message) {
        // Epidemic propagation - gossip to random peers
        const targets = this.peers.selectRandomPeers(Math.ceil(this.config.fanout / 2));
        
        for (const peer of targets) {
            this.transport.send(peer.id, message).catch(() => {
                this.peers.markPeerFailed(peer.id);
            });
        }
    }

    broadcast(type, payload, options = {}) {
        const message = {
            type,
            payload,
            sender: this.config.nodeId,
            vectorClock: this.vectorClock.increment(),
            timestamp: Date.now(),
            hops: 0,
            maxHops: options.maxHops || 5,
            ...options
        };

        // Store locally
        const messageId = this.generateMessageId(message);
        this.messageStore.set(messageId, message);

        // Immediate broadcast to all peers
        for (const peer of this.peers.getAll()) {
            this.transport.send(peer.id, message).catch(() => {
                this.peers.markPeerFailed(peer.id);
            });
        }

        return messageId;
    }

    sendToPeer(peerId, type, payload) {
        return this.transport.send(peerId, {
            type,
            payload,
            sender: this.config.nodeId,
            timestamp: Date.now()
        });
    }

    generateNodeId() {
        return `gossip-${Math.random().toString(36).substr(2, 9)}`;
    }

    generateMessageId(message) {
        return `${message.sender}-${message.timestamp}-${message.type}`;
    }

    getCapabilities() {
        return {
            billing: true,
            auth: true,
            relay: true,
            mesh: true
        };
    }

    getStats() {
        return {
            nodeId: this.config.nodeId,
            peers: this.peers.size,
            messagesStored: this.messageStore.size,
            vectorClock: this.vectorClock.get()
        };
    }

    emit(event, data) {
        // Event emission for external listeners
    }
}

export default GossipNode;