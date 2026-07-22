package com.wifibilling.agent.protocols;

import android.content.Context;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;
import org.webrtc.*;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

public class WebRTCDataChannel {
    private static final String TAG = "WebRTCDataChannel";
    private Context context;
    private GossipNode gossipNode;
    private PeerConnectionFactory factory;
    private ConcurrentHashMap<String, PeerConnection> connections = new ConcurrentHashMap<>();
    private ConcurrentHashMap<String, DataChannel> dataChannels = new ConcurrentHashMap<>();

    public WebRTCDataChannel(Context context, GossipNode gossipNode) {
        this.context = context;
        this.gossipNode = gossipNode;
    }

    public void initialize() {
        PeerConnectionFactory.InitializationOptions options =
                PeerConnectionFactory.InitializationOptions.builder(context)
                        .createInitializationOptions();
        PeerConnectionFactory.initialize(options);

        PeerConnectionFactory.Options factoryOptions = new PeerConnectionFactory.Options();
        factory = PeerConnectionFactory.builder()
                .setOptions(factoryOptions)
                .createPeerConnectionFactory();
    }

    public void send(String peerId, JSONObject message) {
        DataChannel channel = dataChannels.get(peerId);
        if (channel != null && channel.state() == DataChannel.State.OPEN) {
            java.nio.ByteBuffer buffer = java.nio.ByteBuffer.wrap(message.toString().getBytes());
            channel.send(new DataChannel.Buffer(buffer, false));
        } else {
            initiateConnection(peerId, message);
        }
    }

    private void initiateConnection(String peerId, JSONObject initialMessage) {
        List<PeerConnection.IceServer> iceServers = new ArrayList<>();
        iceServers.add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer());

        PeerConnection.RTCConfiguration rtcConfig = new PeerConnection.RTCConfiguration(iceServers);
        PeerConnection connection = factory.createPeerConnection(rtcConfig, new PeerConnection.Observer() {
            @Override public void onIceCandidate(IceCandidate candidate) {
                // In production, send this back to peer via signaling (e.g., Bluetooth or MQTT)
            }
            @Override public void onDataChannel(DataChannel channel) {
                setupDataChannel(peerId, channel);
            }
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
            @Override public void onIceConnectionReceivingChange(boolean b) {}
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {}
            @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
            @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
            @Override public void onAddStream(MediaStream stream) {}
            @Override public void onRemoveStream(MediaStream stream) {}
            @Override public void onRenegotiationNeeded() {}
            @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
        });

        DataChannel.Init init = new DataChannel.Init();
        DataChannel channel = connection.createDataChannel("gossip", init);
        setupDataChannel(peerId, channel);
        connections.put(peerId, connection);
    }

    private void setupDataChannel(String peerId, DataChannel channel) {
        channel.registerObserver(new DataChannel.Observer() {
            @Override public void onBufferedAmountChange(long l) {}
            @Override public void onStateChange() {
                Log.d(TAG, "Data channel state: " + channel.state());
            }
            @Override public void onMessage(DataChannel.Buffer buffer) {
                byte[] data = new byte[buffer.data.remaining()];
                buffer.data.get(data);
                try {
                    JSONObject json = new JSONObject(new String(data));
                    gossipNode.handleIncomingMessage(peerId, json);
                } catch (JSONException e) {
                    Log.e(TAG, "Failed to parse WebRTC message", e);
                }
            }
        });
        dataChannels.put(peerId, channel);
    }

    public void shutdown() {
        for (DataChannel channel : dataChannels.values()) channel.dispose();
        for (PeerConnection connection : connections.values()) connection.dispose();
        if (factory != null) factory.dispose();
    }
}
