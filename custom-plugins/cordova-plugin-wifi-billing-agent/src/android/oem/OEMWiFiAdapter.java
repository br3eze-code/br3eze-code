package com.wifibilling.agent.oem;

import org.json.JSONObject;
import org.apache.cordova.CallbackContext;

/**
 * OEM WiFi Adapter Interface
 */
public interface OEMWiFiAdapter {

    void initialize();

    String getAdapterType();

    // Core WiFi operations
    JSONObject connect(JSONObject options) throws Exception;

    JSONObject disconnect() throws Exception;

    JSONObject getConnectionInfo() throws Exception;

    JSONObject scan() throws Exception;

    // OEM-specific features
    boolean isOEMAvailable();

    JSONObject getOEMCapabilities();
}