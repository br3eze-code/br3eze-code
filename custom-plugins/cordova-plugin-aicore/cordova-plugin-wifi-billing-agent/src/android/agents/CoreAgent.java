package com.wifibilling.agent.agents;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CoreAgent {

    private Context context;
    private String agentId;
    private String nodeType;
    private ExecutorService executor;
    private Handler mainHandler;

    private Map<String, EventListener> eventListeners = new HashMap<>();
    private Map<String, Object> agents = new HashMap<>();

    private long startTime;
    private JSONObject metrics;

    public CoreAgent(Context context, JSONObject config) {
        this.context = context;
        this.agentId = config.optString("agentId", generateAgentId());
        this.nodeType = config.optString("nodeType", "mobile");
        this.executor = Executors.newCachedThreadPool();
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.startTime = System.currentTimeMillis();
        this.metrics = new JSONObject();
    }

    public void initialize() {
        // Initialize core systems
    }

    public String getAgentId() {
        return agentId;
    }

    public void registerAgent(String type, Object agent) {
        agents.put(type, agent);
    }

    public Object getAgent(String type) {
        return agents.get(type);
    }

    public JSONObject processIntent(String input, JSONObject context) throws JSONException {
        // Simple intent processing - in production, this would use ML
        JSONObject result = new JSONObject();

        input = input.toLowerCase();

        if (input.contains("connect") || input.contains("join")) {
            result.put("intent", "wifi_connect");
            result.put("confidence", 0.9);
            result.put("requiresConfirmation", false);
            result.put("actions", new JSONObject()
                    .put("agent", "wifi")
                    .put("method", "connect")
                    .put("params", extractNetworkFromInput(input)));
        } else if (input.contains("disconnect") || input.contains("leave")) {
            result.put("intent", "wifi_disconnect");
            result.put("confidence", 0.95);
            result.put("requiresConfirmation", true);
            result.put("actions", new JSONObject()
                    .put("agent", "wifi")
                    .put("method", "disconnect"));
        } else if (input.contains("status") || input.contains("info")) {
            result.put("intent", "get_status");
            result.put("confidence", 0.8);
            result.put("requiresConfirmation", false);
        } else {
            result.put("intent", "unknown");
            result.put("confidence", 0.0);
            result.put("actions", JSONObject.NULL);
        }

        return result;
    }

    public void registerEventListener(String event, EventListener listener) {
        eventListeners.put(event, listener);
    }

    public void emitEvent(String event, JSONObject data) {
        EventListener listener = eventListeners.get(event);
        if (listener != null) {
            mainHandler.post(() -> listener.onEvent(data));
        }
    }

    public JSONObject getStatus() throws JSONException {
        JSONObject status = new JSONObject();
        status.put("agentId", agentId);
        status.put("nodeType", nodeType);
        status.put("uptime", System.currentTimeMillis() - startTime);
        status.put("registeredAgents", agents.keySet());
        return status;
    }

    public void shutdown() {
        executor.shutdown();
    }

    private String generateAgentId() {
        return "pc-agent-" + System.currentTimeMillis() + "-" +
                UUID.randomUUID().toString().substring(0, 8);
    }

    private JSONObject extractNetworkFromInput(String input) throws JSONException {
        // Simple extraction - would use NLP in production
        JSONObject params = new JSONObject();
        // Extract SSID if mentioned
        return params;
    }

    public interface EventListener {
        void onEvent(JSONObject data);
    }
}