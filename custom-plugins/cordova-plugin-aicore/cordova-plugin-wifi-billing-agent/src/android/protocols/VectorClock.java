package com.wifibilling.agent.protocols;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

public class VectorClock {
    private String nodeId;
    private Map<String, Long> versions;

    public VectorClock(String nodeId) {
        this.nodeId = nodeId;
        this.versions = new HashMap<>();
        this.versions.put(nodeId, 0L);
    }

    public void increment() {
        versions.put(nodeId, versions.getOrDefault(nodeId, 0L) + 1);
    }

    public void merge(VectorClock other) {
        for (Map.Entry<String, Long> entry : other.versions.entrySet()) {
            long remoteVersion = entry.getValue();
            long localVersion = versions.getOrDefault(entry.getKey(), 0L);
            versions.put(entry.getKey(), Math.max(localVersion, remoteVersion));
        }
    }

    public JSONObject toJSON() throws JSONException {
        JSONObject json = new JSONObject();
        for (Map.Entry<String, Long> entry : versions.entrySet()) {
            json.put(entry.getKey(), entry.getValue());
        }
        return json;
    }

    public static VectorClock fromJSON(JSONObject json) throws JSONException {
        VectorClock clock = new VectorClock("");
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            clock.versions.put(key, json.getLong(key));
        }
        return clock;
    }

    public boolean isAfter(VectorClock other) {
        boolean atLeastOneGreater = false;
        for (Map.Entry<String, Long> entry : versions.entrySet()) {
            long otherVersion = other.versions.getOrDefault(entry.getKey(), 0L);
            if (entry.getValue() < otherVersion) return false;
            if (entry.getValue() > otherVersion) atLeastOneGreater = true;
        }
        return atLeastOneGreater;
    }
}
