package com.wifibilling.agent.protocols;

import android.content.Context;
import android.net.wifi.p2p.WifiP2pConfig;
import android.net.wifi.p2p.WifiP2pDevice;
import android.net.wifi.p2p.WifiP2pManager;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class GossipNode {

    private Context context;
    private String nodeId;
    private int gossipInterval;
    private int fanout;
    private Handler handler;
    private ExecutorService executor;
    private Random random;

    private Map<String, Peer> peers = new ConcurrentHashMap<>();
    private Map<String, GossipMessage> messageStore = new ConcurrentHashMap<>();
    private Map<String, VectorClock> vectorClocks = new HashMap<>();

    private boolean isRunning = false;
    private Runnable gossipRunnable;

    // Transport layers
    private WebRTCDataChannel webRTC;
    private BluetoothMesh bluetoothMesh;

    public GossipNode(Context context, JSONObject config) {
        this.context = context;
        this.nodeId = config.optString("agentId", "unknown");
        this.gossipInterval = config.optInt("gossipInterval", 5000);
        this.fanout = config.optInt("fanout", 3);
        this.handler = new Handler(Looper.getMainLooper());
        this.executor = Executors.newCachedThreadPool();
        this.random = new Random();

        // Initialize transports
        this.webRTC = new WebRTCDataChannel(context, this);
        this.bluetoothMesh = new BluetoothMesh(context, this);
    }

    public void start() {
        if (isRunning)
            return;

        isRunning = true;

        // Start transports
        webRTC.initialize();
        bluetoothMesh.initialize();

        // Start gossip rounds
        gossipRunnable = new Runnable() {
            @Override
            public void run() {
                if (isRunning) {
                    performGossipRound();
                    handler.postDelayed(this, gossipInterval);
                }
            }
        };
        handler.postDelayed(gossipRunnable, gossipInterval);
    }

    public void stop() {
        isRunning = false;
        handler.removeCallbacks(gossipRunnable);
        webRTC.shutdown();
        bluetoothMesh.shutdown();
        executor.shutdown();
    }

    private void performGossipRound() {
        if (peers.isEmpty())
            return;

        // Select random peers to gossip with
        Peer[] peerArray = peers.values().toArray(new Peer[0]);
        int targetCount = Math.min(fanout, peerArray.length);

        for (int i = 0; i < targetCount; i++) {
            Peer target = peerArray[random.nextInt(peerArray.length)];
            sendGossipToPeer(target);
        }
    }

    private void sendGossipToPeer(Peer peer) {
        executor.execute(() -> {
            try {
                // Get recent messages
                JSONArray messages = getRecentMessages();

                JSONObject gossip = new JSONObject();
                gossip.put("type", "gossip");
                gossip.put("sender", nodeId);
                gossip.put("vectorClock", getVectorClock().toJSON());
                gossip.put("messages", messages);

                // Send via appropriate transport
                if (peer.supportsWebRTC) {
                    webRTC.send(peer.id, gossip);
                } else {
                    bluetoothMesh.send(peer.id, gossip);
                }

            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    public void handleIncomingMessage(String peerId, JSONObject message) {
        try {
            // Update vector clock
            VectorClock receivedClock = VectorClock.fromJSON(message.getJSONObject("vectorClock"));
            mergeVectorClock(receivedClock);

            // Process messages
            if (message.has("messages")) {
                JSONArray messages = message.getJSONArray("messages");
                for (int i = 0; i < messages.length(); i++) {
                    processMessage(messages.getJSONObject(i));
                }
            }

            // Handle direct messages
            if (!message.optString("type", "").equals("gossip")) {
                processMessage(message);
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void processMessage(JSONObject msg) throws JSONException {
        String messageId = msg.getString("id");

        // Check if already seen
        if (messageStore.containsKey(messageId)) {
            return;
        }

        // Store message
        GossipMessage gossipMsg = new GossipMessage();
        gossipMsg.id = messageId;
        gossipMsg.type = msg.getString("type");
        gossipMsg.payload = msg.getJSONObject("payload");
        gossipMsg.timestamp = msg.getLong("timestamp");
        gossipMsg.sender = msg.getString("sender");
        gossipMsg.vectorClock = VectorClock.fromJSON(msg.getJSONObject("vectorClock"));

        messageStore.put(messageId, gossipMsg);

        // Route to appropriate handler
        routeMessage(gossipMsg);
    }

    private void routeMessage(GossipMessage msg) {
        // Emit to core agent for routing to appropriate agent
        // billing_sync -> BillingAgent
        // auth_broadcast -> AuthAgent
        // presence_heartbeat -> update peer registry

        switch (msg.type) {
            case "billing_sync":
                // Forward to billing agent
                break;
            case "auth_broadcast":
                // Forward to auth agent
                break;
            case "presence_heartbeat":
                updatePeerPresence(msg);
                break;
        }
    }

    private void updatePeerPresence(GossipMessage msg) {
        Peer peer = peers.get(msg.sender);
        if (peer == null) {
            peer = new Peer();
            peer.id = msg.sender;
            peers.put(msg.sender, peer);
        }
        peer.lastSeen = System.currentTimeMillis();
        peer.capabilities = msg.payload.optJSONObject("capabilities");
    }

    public String broadcast(String type, JSONObject payload) {
        try {
            String messageId = generateMessageId();

            JSONObject message = new JSONObject();
            message.put("id", messageId);
            message.put("type", type);
            message.put("payload", payload);
            message.put("sender", nodeId);
            message.put("timestamp", System.currentTimeMillis());
            message.put("vectorClock", incrementVectorClock().toJSON());
            message.put("ttl", 10); // Time-to-live hops

            // Store locally
            GossipMessage gossipMsg = new GossipMessage();
            gossipMsg.id = messageId;
            gossipMsg.type = type;
            gossipMsg.payload = payload;
            gossipMsg.timestamp = System.currentTimeMillis();
            gossipMsg.sender = nodeId;
            messageStore.put(messageId, gossipMsg);

            // Broadcast to all peers
            for (Peer peer : peers.values()) {
                sendMessageToPeer(peer, message);
            }

            return messageId;

        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private void sendMessageToPeer(Peer peer, JSONObject message) {
        executor.execute(() -> {
            try {
                if (peer.supportsWebRTC) {
                    webRTC.send(peer.id, message);
                } else {
                    bluetoothMesh.send(peer.id, message);
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    public JSONObject getPeers() throws JSONException {
        JSONObject result = new JSONObject();
        JSONArray peerArray = new JSONArray();

        for (Peer peer : peers.values()) {
            JSONObject p = new JSONObject();
            p.put("id", peer.id);
            p.put("lastSeen", peer.lastSeen);
            p.put("latency", peer.latency);
            p.put("supportsWebRTC", peer.supportsWebRTC);
            p.put("supportsBluetooth", peer.supportsBluetooth);
            peerArray.put(p);
        }

        result.put("peers", peerArray);
        result.put("count", peers.size());
        return result;
    }

    public int getPeerCount() {
        return peers.size();
    }

    public JSONObject getStats() throws JSONException {
        JSONObject stats = new JSONObject();
        stats.put("nodeId", nodeId);
        stats.put("peers", peers.size());
        stats.put("messagesStored", messageStore.size());
        stats.put("running", isRunning);
        return stats;
    }

    private JSONArray getRecentMessages() throws JSONException {
        JSONArray recent = new JSONArray();
        long cutoff = System.currentTimeMillis() - 300000; // 5 minutes

        for (GossipMessage msg : messageStore.values()) {
            if (msg.timestamp > cutoff) {
                JSONObject m = new JSONObject();
                m.put("id", msg.id);
                m.put("type", msg.type);
                m.put("payload", msg.payload);
                m.put("timestamp", msg.timestamp);
                m.put("sender", msg.sender);
                m.put("vectorClock", msg.vectorClock.toJSON());
                recent.put(m);
            }
        }

        return recent;
    }

    private VectorClock getVectorClock() {
        return vectorClocks.getOrDefault(nodeId, new VectorClock(nodeId));
    }

    private VectorClock incrementVectorClock() {
        VectorClock clock = getVectorClock();
        clock.increment();
        vectorClocks.put(nodeId, clock);
        return clock;
    }

    private void mergeVectorClock(VectorClock other) {
        VectorClock local = getVectorClock();
        local.merge(other);
    }

    private String generateMessageId() {
        return nodeId + "-" + System.currentTimeMillis() + "-" + random.nextInt(10000);
    }

    // Peer class
    private static class Peer {
        String id;
        long lastSeen;
        long latency;
        boolean supportsWebRTC;
        boolean supportsBluetooth;
        JSONObject capabilities;
    }

    // Message class
    private static class GossipMessage {
        String id;
        String type;
        JSONObject payload;
        long timestamp;
        String sender;
        VectorClock vectorClock;
        int hops;
    }
}
