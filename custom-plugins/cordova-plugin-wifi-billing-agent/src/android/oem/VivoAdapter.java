package com.wifibilling.agent.oem;

import android.content.Context;
import android.util.Log;

public class VivoAdapter extends OEMWiFiAdapter {
    private static final String TAG = "VivoAdapter";

    public VivoAdapter(Context context) {
        super(context);
    }

    @Override
    public boolean performOptimalConnection(String ssid, String password) {
        Log.d(TAG, "Connecting to " + ssid + " using Vivo optimization");
        // Implementing Vivo-specific connection logic
        return super.performOptimalConnection(ssid, password);
    }
}
