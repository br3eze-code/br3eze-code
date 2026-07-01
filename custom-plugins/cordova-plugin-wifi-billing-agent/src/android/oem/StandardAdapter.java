package com.wifibilling.agent.oem;

import android.content.Context;
import android.util.Log;

public class StandardAdapter extends OEMWiFiAdapter {
    private static final String TAG = "StandardAdapter";

    public StandardAdapter(Context context) {
        super(context);
    }

    @Override
    public boolean performOptimalConnection(String ssid, String password) {
        Log.d(TAG, "Connecting to " + ssid + " using Standard Android logic");
        return super.performOptimalConnection(ssid, password);
    }
}
