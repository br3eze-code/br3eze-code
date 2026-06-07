package com.wifibilling.agent.oem;

import android.content.Context;
import org.json.JSONObject;
import org.apache.cordova.CallbackContext;

public class HMSAdapter implements OEMWiFiAdapter {
    private Context context;

    public HMSAdapter(Context context) {
        this.context = context;
    }

    @Override
    public void initialize() {}

    @Override
    public String getAdapterType() { return "HMS"; }

    @Override
    public JSONObject connect(JSONObject options) throws Exception { return new JSONObject().put("success", true); }

    @Override
    public JSONObject disconnect() throws Exception { return new JSONObject().put("success", true); }

    @Override
    public JSONObject getConnectionInfo() throws Exception { return new JSONObject().put("connected", true); }

    @Override
    public JSONObject scan() throws Exception { return new JSONObject(); }

    @Override
    public boolean isOEMAvailable() { return false; }

    @Override
    public JSONObject getOEMCapabilities() { return new JSONObject(); }

    public void fastConnect(JSONObject options, CallbackContext callbackContext) {
        callbackContext.error("HMS not available");
    }
}