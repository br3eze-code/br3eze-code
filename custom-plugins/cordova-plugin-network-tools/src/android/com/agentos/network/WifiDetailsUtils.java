package com.agentos.network;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.DhcpInfo;
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

/**
 * Normalized Wi-Fi connection telemetry.
 *
 * Platform-specific Android APIs stay behind this adapter. Values that cannot
 * be read on a device/OS/permission state are represented as UNKNOWN/-1 rather
 * than turning an optional capability into a plugin failure.
 */
public final class WifiDetailsUtils {
    private WifiDetailsUtils() {}

    public static void getAllWifiDetails(CordovaInterface cordova, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                Context context = cordova.getActivity().getApplicationContext();
                WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
                if (wifiManager == null) {
                    callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK,
                            baseResult(false, "WIFI_MANAGER_UNAVAILABLE")));
                    return;
                }

                JSONObject details = new JSONObject();
                details.put("supported", true);
                details.put("available", true);
                details.put("permissionState", wifiPermissionState(context));
                details.put("isWifiEnabled", isWifiEnabled(wifiManager));
                details.put("isSupportWifi", true);

                WifiInfo wifiInfo = null;
                if (hasWifiPermission(context)) {
                    try {
                        wifiInfo = wifiManager.getConnectionInfo();
                    } catch (SecurityException ignored) {
                        details.put("permissionState", "denied");
                    }
                }

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
                    int frequency = safeFrequency(wifiInfo);
                    details.put("frequency", frequency > 0 ? frequency + " MHz" : "UNKNOWN");
                    details.put("channel", getChannelFromFrequency(frequency));
                } else {
                    putUnknownWifi(details);
                }

                DhcpInfo dhcpInfo = null;
                if (hasWifiPermission(context)) {
                    try {
                        dhcpInfo = wifiManager.getDhcpInfo();
                    } catch (SecurityException ignored) {
                        // Keep normalized UNKNOWN values.
                    }
                }
                if (dhcpInfo != null) {
                    details.put("gateway", formatAddress(dhcpInfo.gateway));
                    details.put("dns1", formatAddress(dhcpInfo.dns1));
                    details.put("dns2", formatAddress(dhcpInfo.dns2));
                } else {
                    details.put("gateway", "UNKNOWN");
                    details.put("dns1", "UNKNOWN");
                    details.put("dns2", "UNKNOWN");
                }

                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, normalize(details)));
            } catch (Exception e) {
                JSONObject degraded = baseResult(false, "WIFI_DETAILS_UNAVAILABLE");
                try { degraded.put("error", safeMessage(e)); } catch (JSONException ignored) {}
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, degraded));
            }
        });
    }

    private static JSONObject baseResult(boolean available, String reason) {
        JSONObject result = new JSONObject();
        try {
            result.put("supported", true);
            result.put("available", available);
            result.put("permissionState", "unknown");
            result.put("reason", reason);
            putUnknownWifi(result);
            result.put("gateway", "UNKNOWN");
            result.put("dns1", "UNKNOWN");
            result.put("dns2", "UNKNOWN");
        } catch (JSONException ignored) {}
        return result;
    }

    private static JSONObject normalize(JSONObject details) throws JSONException {
        JSONObject normalized = new JSONObject();
        Iterator<String> keys = details.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            normalized.put(key.toLowerCase(java.util.Locale.ROOT), details.get(key));
        }
        return normalized;
    }

    private static boolean hasWifiPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return context.checkSelfPermission(Manifest.permission.ACCESS_WIFI_STATE) == PackageManager.PERMISSION_GRANTED
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                    || context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED);
    }

    private static String wifiPermissionState(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return "not_required";
        if (hasWifiPermission(context)) return "granted";
        return "denied";
    }

    private static boolean isWifiEnabled(WifiManager manager) {
        try { return manager.isWifiEnabled(); }
        catch (SecurityException ignored) { return false; }
    }

    private static int safeFrequency(WifiInfo wifiInfo) {
        try { return wifiInfo.getFrequency(); }
        catch (RuntimeException ignored) { return -1; }
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
        if (value == null || value.length() == 0 || "<unknown ssid>".equalsIgnoreCase(value)) return "UNKNOWN";
        return value;
    }

    private static String formatAddress(int address) {
        return address == 0 ? "UNKNOWN" : Formatter.formatIpAddress(address);
    }

    /** Converts Wi-Fi center frequency in MHz to a channel without the 2.4 GHz channel-14 bug. */
    private static int getChannelFromFrequency(int frequency) {
        if (frequency >= 2412 && frequency <= 2472 && ((frequency - 2412) % 5 == 0)) {
            return ((frequency - 2412) / 5) + 1;
        }
        if (frequency == 2484) return 14;
        if (frequency >= 5000 && frequency <= 5900 && ((frequency - 5000) % 5 == 0)) {
            return (frequency - 5000) / 5;
        }
        if (frequency >= 5955 && frequency <= 7115 && ((frequency - 5950) % 5 == 0)) {
            return (frequency - 5950) / 5;
        }
        return -1;
    }

    private static String safeMessage(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }
}
