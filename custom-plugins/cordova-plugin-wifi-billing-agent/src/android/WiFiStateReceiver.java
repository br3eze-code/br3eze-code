package com.wifibilling.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.NetworkInfo;
import android.net.wifi.WifiManager;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

public class WiFiStateReceiver extends BroadcastReceiver {
    private static final String TAG = "WiFiStateReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (WifiManager.NETWORK_STATE_CHANGED_ACTION.equals(action)) {
            NetworkInfo info = intent.getParcelableExtra(WifiManager.EXTRA_NETWORK_INFO);
            if (info != null && info.isConnected()) {
                Log.d(TAG, "WiFi connected, notifying agents");
                // Notify core agent of connectivity change
                notifyConnectivityChange(context, true, info.getExtraInfo());
            } else {
                Log.d(TAG, "WiFi disconnected");
                notifyConnectivityChange(context, false, null);
            }
        }
    }

    private void notifyConnectivityChange(Context context, boolean connected, String ssid) {
        Intent intent = new Intent("com.wifibilling.WIFI_STATE_CHANGED");
        intent.putExtra("connected", connected);
        intent.putExtra("ssid", ssid);
        context.sendBroadcast(intent);
    }
}
