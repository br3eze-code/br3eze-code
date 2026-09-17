package com.agentos.network;

import android.content.Context;
import android.net.wifi.DhcpInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.text.format.Formatter;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.PluginResult;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;

/** Normalized Wi-Fi connection telemetry. Domain-agnostic Cordova adapter. */
public final class WifiDetailsUtils {
    private WifiDetailsUtils() {}

    public static void getAllWifiDetails(CordovaInterface cordova, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                Context context = cordova.getActivity().getApplicationContext();
                WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
                if (wifiManager == null) {
                    callbackContext.error("WifiManager not available");
                    return;
                }

                WifiInfo wifiInfo = wifiManager.getConnectionInfo();
                DhcpInfo dhcpInfo = wifiManager.getDhcpInfo();
                JSONObject details = new JSONObject();
                details.put("isWifiEnabled", isWifiEnabled(wifiManager));
                details.put("isSupportWifi", true);

                if (wifiInfo != null) {
                    details.put("ssid", valueOrUnknown(wifiInfo.getSSID()));
                    details.put("bssid", valueOrUnknown(wifiInfo.getBSSID()));
                    details.put("ip", Formatter.formatIpAddress(wifiInfo.getIpAddress()));
                    details.put("mac", valueOrUnknown(wifiInfo.getMacAddress()));
                    details.put("networkId", wifiInfo.getNetworkId());
                    details.put("linkSpeedMbps", wifiInfo.getLinkSpeed());
                    details.put("signalStrength", wifiInfo.getRssi());
                    details.put("rssi", wifiInfo.getRssi());
                    details.put("speed", wifiInfo.getLinkSpeed() + " Mbps");
                    details.put("frequency", wifiInfo.getFrequency() + " MHz");
                    details.put("channel", getChannelFromFrequency(wifiInfo.getFrequency()));
                } else {
                    putUnknownWifi(details);
                }

                if (dhcpInfo != null) {
                    details.put("gateway", Formatter.formatIpAddress(dhcpInfo.gateway));
                    details.put("dns1", Formatter.formatIpAddress(dhcpInfo.dns1));
                    details.put("dns2", Formatter.formatIpAddress(dhcpInfo.dns2));
                } else {
                    details.put("gateway", "UNKNOWN");
                    details.put("dns1", "UNKNOWN");
                    details.put("dns2", "UNKNOWN");
                }

                JSONObject normalized = new JSONObject();
                Iterator<String> keys = details.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    normalized.put(key.toLowerCase(), details.get(key));
                }
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, normalized));
            } catch (Exception e) {
                callbackContext.error("Error getting Wi-Fi details: " + e.getMessage());
            }
        });
    }

    private static boolean isWifiEnabled(WifiManager manager) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return manager.isWifiEnabled();
            }
            return manager.isWifiEnabled();
        } catch (SecurityException ignored) {
            return false;
        }
    }

    private static void putUnknownWifi(JSONObject details) throws JSONException {
        details.put("ssid", "UNKNOWN");
        details.put("bssid", "UNKNOWN");
        details.put("ip", "UNKNOWN");
        details.put("mac", "UNKNOWN");
        details.put("networkId", -1);
        details.put("linkSpeedMbps", -1);
        details.put("signalStrength", -1);
        details.put("rssi", -1);
        details.put("speed", "UNKNOWN");
        details.put("frequency", "UNKNOWN");
        details.put("channel", -1);
    }

    private static String valueOrUnknown(String value) {
        if (value == null || value.length() == 0 || "<unknown ssid>".equalsIgnoreCase(value)) {
            return "UNKNOWN";
        }
        return value;
    }

    private static int getChannelFromFrequency(int frequency) {
        if (frequency >= 2412 && frequency <= 2472) return (frequency - 2407) / 5;
        if (frequency == 2484) return 14;
        if (frequency >= 5000 && frequency <= 5900) return (frequency - 5000) / 5;
        if (frequency >= 5955 && frequency <= 7115) return (frequency - 5950) / 5;
        return -1;
    }
}
