package com.agentos.network;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
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

public class AgentOSNetworkToolsPlugin extends CordovaPlugin {
    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        if ("capabilities".equals(action)) {
            callbackContext.success(capabilities());
            return true;
        }
        if ("connectivity".equals(action)) {
            callbackContext.success(connectivity());
            return true;
        }
        if ("interfaces".equals(action)) {
            callbackContext.success(interfaces());
            return true;
        }
        if ("agentRequest".equals(action)) {
            callbackContext.error("AgentOS network-tool execution must be authorized by the gateway");
            return true;
        }
        callbackContext.error("Unknown action: " + action);
        return false;
    }

    private JSONObject capabilities() throws JSONException {
        JSONObject result = new JSONObject();
        result.put("supported", true);
        result.put("platform", "android");
        result.put("localTelemetry", true);
        result.put("agentGatewayRequests", false);
        result.put("actions", new JSONArray().put("capabilities").put("connectivity").put("interfaces"));
        return result;
    }

    private JSONObject connectivity() throws JSONException {
        JSONObject result = new JSONObject();
        ConnectivityManager manager = (ConnectivityManager) cordova.getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = manager == null ? null : manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        result.put("connected", capabilities != null);
        result.put("transport", transport(capabilities));
        result.put("validated", capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));

        if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            WifiManager wifi = (WifiManager) cordova.getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo info = wifi == null ? null : wifi.getConnectionInfo();
            if (info != null) {
                result.put("ssid", sanitizeSsid(info.getSSID()));
                result.put("linkSpeedMbps", info.getLinkSpeed());
            }
        }
        return result;
    }

    private String transport(NetworkCapabilities capabilities) {
        if (capabilities == null) return "offline";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return "vpn";
        return "other";
    }

    private String sanitizeSsid(String ssid) {
        if (ssid == null || "<unknown ssid>".equals(ssid)) return "unknown";
        return ssid.replace("\"", "");
    }

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
        } catch (Exception error) {
            throw new JSONException("Unable to enumerate network interfaces: " + error.getMessage());
        }
        return result;
    }
}
