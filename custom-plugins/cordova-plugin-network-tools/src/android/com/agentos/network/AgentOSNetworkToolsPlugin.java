package com.agentos.network;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.NetworkInterface;
import java.util.Collections;

/** Domain-agnostic Cordova adapter for local network telemetry. */
public class AgentOSNetworkToolsPlugin extends CordovaPlugin {
    private static final String CONTRACT_VERSION = "1.0";

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if ("capabilities".equals(action)) { callbackContext.success(capabilities()); return true; }
        if ("connectivity".equals(action)) { callbackContext.success(connectivity()); return true; }
        if ("interfaces".equals(action)) { callbackContext.success(interfaces()); return true; }
        if ("wifiSignalStrength".equals(action)) { WifiUtils.getSignalStrength(cordova.getContext(), callbackContext); return true; }
        if ("wifiStrength".equals(action)) { WifiUtils.getWifiStrength(cordova.getContext(), callbackContext); return true; }
        if ("wifiList".equals(action)) { WifiUtils.getWifiList(cordova, callbackContext); return true; }
        if ("wifiDetails".equals(action)) { WifiDetailsUtils.getAllWifiDetails(cordova, callbackContext); return true; }
        if ("ipInfo".equals(action)) {
            boolean includeLocation = false;
            if (args != null && args.length() > 0 && args.optJSONObject(0) != null) {
                includeLocation = args.optJSONObject(0).optBoolean("includeLocation", false);
            }
            IpInfoUtils.getIpInfo(cordova, callbackContext, includeLocation);
            return true;
        }
        if ("connectedDevices".equals(action)) { WifiUtils.getConnectedDevices(cordova.getContext(), cordova, callbackContext); return true; }
        if ("agentRequest".equals(action)) { callbackContext.error("AgentOS network-tool execution must be authorized by the gateway"); return true; }
        callbackContext.error("Unknown action: " + action);
        return false;
    }

    private JSONObject capabilities() throws JSONException {
        JSONObject result = new JSONObject();
        result.put("contractVersion", CONTRACT_VERSION);
        result.put("supported", true);
        result.put("available", true);
        result.put("platform", "android");
        result.put("localTelemetry", true);
        result.put("permissionAware", true);
        result.put("gracefulDegradation", true);
        result.put("agentGatewayRequests", false);
        result.put("optionalLocationEnrichment", true);
        result.put("actions", new JSONArray()
                .put("capabilities").put("connectivity").put("interfaces")
                .put("wifiSignalStrength").put("wifiStrength").put("wifiList")
                .put("wifiDetails").put("ipInfo").put("connectedDevices"));
        return result;
    }

    private JSONObject connectivity() throws JSONException {
        JSONObject result = new JSONObject();
        result.put("contractVersion", CONTRACT_VERSION);
        ConnectivityManager manager = (ConnectivityManager) cordova.getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return result.put("connected", false).put("transport", "offline").put("validated", false).put("available", false);
        NetworkCapabilities capabilities = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network network = manager.getActiveNetwork();
            capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        } else {
            NetworkInfo info = manager.getActiveNetworkInfo();
            result.put("connected", info != null && info.isConnected());
            result.put("transport", info == null ? "offline" : legacyTransport(info.getType()));
            result.put("validated", false);
            result.put("available", true);
            return result;
        }
        result.put("connected", capabilities != null);
        result.put("transport", transport(capabilities));
        result.put("validated", capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
        result.put("available", true);
        if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            WifiManager wifi = (WifiManager) cordova.getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo info = wifi == null ? null : wifi.getConnectionInfo();
            if (info != null) { result.put("ssid", sanitizeSsid(info.getSSID())); result.put("linkSpeedMbps", info.getLinkSpeed()); }
        }
        return result;
    }

    private String legacyTransport(int type) {
        switch (type) { case 1: return "wifi"; case 9: return "ethernet"; case 0: return "cellular"; default: return "other"; }
    }

    private String transport(NetworkCapabilities capabilities) {
        if (capabilities == null) return "offline";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "vpn";
        return "other";
    }

    private String sanitizeSsid(String ssid) { return ssid == null || "<unknown ssid>".equals(ssid) ? "UNKNOWN" : ssid.replace("\"", ""); }

    private JSONArray interfaces() throws JSONException {
        JSONArray result = new JSONArray();
        try {
            for (NetworkInterface networkInterface : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                JSONObject item = new JSONObject();
                item.put("name", networkInterface.getName());
                item.put("displayName", networkInterface.getDisplayName());
                item.put("up", networkInterface.isUp());
                item.put("loopback", networkInterface.isLoopback());
                item.put("mtu", networkInterface.getMTU());
                JSONArray addresses = new JSONArray();
                Collections.list(networkInterface.getInetAddresses()).forEach(address -> addresses.put(address.getHostAddress()));
                item.put("addresses", addresses);
                result.put(item);
            }
        } catch (Exception error) { throw new JSONException("Unable to enumerate network interfaces: " + error.getMessage()); }
        return result;
    }
}
