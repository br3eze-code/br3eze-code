package com.wifibilling.agent.oem;

import android.content.Context;
import org.json.JSONObject;

public class StandardAdapter implements OEMWiFiAdapter {
    private Context context;

    public StandardAdapter(Context context) {
        this.context = context;
    }

    @Override
    public void initialize() {}

    @Override
    public String getAdapterType() { return "Standard"; }

    @Override
    public JSONObject connect(JSONObject options) throws Exception { return new JSONObject().put("success", true); }

    @Override
    public JSONObject disconnect() throws Exception { return new JSONObject().put("success", true); }

    @Override
    public JSONObject getConnectionInfo() throws Exception { return new JSONObject().put("connected", true); }

    @Override
    public JSONObject scan() throws Exception { return new JSONObject(); }

    @Override
    public boolean isOEMAvailable() { return true; }

    @Override
    public JSONObject getOEMCapabilities() { return new JSONObject(); }
}
