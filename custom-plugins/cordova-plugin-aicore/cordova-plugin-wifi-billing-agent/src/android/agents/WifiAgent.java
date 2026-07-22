package com.wifibilling.agent.agents;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiNetworkSpecifier;
import android.net.wifi.WifiNetworkSuggestion;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class WiFiAgent {

    private Context context;
    private CoreAgent coreAgent;
    private WifiManager wifiManager;
    private ConnectivityManager connectivityManager;

    private String currentSSID;
    private String currentConnectionId;
    private boolean autoReconnectEnabled = false;
    private JSONObject autoReconnectConfig;

    public WiFiAgent(Context context, CoreAgent coreAgent, JSONObject config) {
        this.context = context;
        this.coreAgent = coreAgent;
        this.wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
        this.connectivityManager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    public void initialize() {
        // Setup WiFi state monitoring
    }

    public JSONObject connect(String ssid, String password, JSONObject options) throws JSONException {
        JSONObject result = new JSONObject();

        boolean isHidden = options.optBoolean("isHidden", false);
        String algorithm = options.optString("algorithm", "WPA2");
        String connectionType = options.optString("connectionType", "auto");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10+ use new APIs
            result = connectAndroid10Plus(ssid, password, algorithm, isHidden, connectionType);
        } else {
            // Legacy connection
            result = connectLegacy(ssid, password, algorithm, isHidden);
        }

        if (result.getBoolean("success")) {
            this.currentSSID = ssid;
            this.currentConnectionId = result.optString("connectionId", java.util.UUID.randomUUID().toString());
            result.put("connectionId", this.currentConnectionId);
        }

        return result;
    }

    private JSONObject connectAndroid10Plus(String ssid, String password, String algorithm,
            boolean isHidden, String connectionType) throws JSONException {
        JSONObject result = new JSONObject();

        if (connectionType.equals("specifier") || connectionType.equals("auto")) {
            // Use WifiNetworkSpecifier for app-specific connection
            WifiNetworkSpecifier.Builder specifierBuilder = new WifiNetworkSpecifier.Builder();
            specifierBuilder.setSsid(ssid);

            if (password != null && !password.isEmpty()) {
                specifierBuilder.setWpa2Passphrase(password);
            }

            WifiNetworkSpecifier specifier = specifierBuilder.build();

            NetworkRequest request = new NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .setNetworkSpecifier(specifier)
                    .build();

            connectivityManager.requestNetwork(request, new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    connectivityManager.bindProcessToNetwork(network);
                }
            });

            result.put("success", true);
            result.put("method", "specifier");
            result.put("ssid", ssid);

        } else {
            // Use suggestion API
            WifiNetworkSuggestion.Builder suggestionBuilder = new WifiNetworkSuggestion.Builder();
            suggestionBuilder.setSsid(ssid);
            suggestionBuilder.setIsAppInteractionRequired(false);

            if (password != null && !password.isEmpty()) {
                suggestionBuilder.setWpa2Passphrase(password);
            }

            List<WifiNetworkSuggestion> suggestions = new ArrayList<>();
            suggestions.add(suggestionBuilder.build());

            int status = wifiManager.addNetworkSuggestions(suggestions);

            result.put("success", status == WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS);
            result.put("method", "suggestion");
            result.put("statusCode", status);
        }

        return result;
    }

    private JSONObject connectLegacy(String ssid, String password, String algorithm, boolean isHidden)
            throws JSONException {
        JSONObject result = new JSONObject();

        WifiConfiguration wifiConfig = new WifiConfiguration();
        wifiConfig.SSID = "\"" + ssid + "\"";

        if (password != null && !password.isEmpty()) {
            if (algorithm.equals("WEP")) {
                wifiConfig.wepKeys[0] = "\"" + password + "\"";
                wifiConfig.wepTxKeyIndex = 0;
                wifiConfig.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
                wifiConfig.allowedGroupCiphers.set(WifiConfiguration.GroupCipher.WEP40);
            } else {
                wifiConfig.preSharedKey = "\"" + password + "\"";
            }
        } else {
            wifiConfig.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
        }

        wifiConfig.hiddenSSID = isHidden;

        int netId = wifiManager.addNetwork(wifiConfig);

        if (netId == -1) {
            result.put("success", false);
            result.put("error", "Failed to add network");
            return result;
        }

        wifiManager.disconnect();
        boolean enabled = wifiManager.enableNetwork(netId, true);
        boolean reconnected = wifiManager.reconnect();

        result.put("success", enabled && reconnected);
        result.put("networkId", netId);
        result.put("method", "legacy");

        return result;
    }

    public void disconnect() {
        wifiManager.disconnect();
        currentSSID = null;
        currentConnectionId = null;
    }

    public JSONObject getConnectionInfo() throws JSONException {
        JSONObject info = new JSONObject();

        WifiInfo wifiInfo = wifiManager.getConnectionInfo();

        if (wifiInfo != null && wifiInfo.getNetworkId() != -1) {
            info.put("connected", true);
            info.put("ssid", wifiInfo.getSSID().replace("\"", ""));
            info.put("bssid", wifiInfo.getBSSID());
            info.put("ipAddress", formatIpAddress(wifiInfo.getIpAddress()));
            info.put("linkSpeed", wifiInfo.getLinkSpeed());
            info.put("rssi", wifiInfo.getRssi());
            info.put("networkId", wifiInfo.getNetworkId());

            if (currentConnectionId != null) {
                info.put("connectionId", currentConnectionId);
            }
        } else {
            info.put("connected", false);
        }

        return info;
    }

    public JSONArray scan(int timeout, boolean includeHidden, int minSignalLevel) throws JSONException {
        JSONArray networks = new JSONArray();

        if (!wifiManager.isWifiEnabled()) {
            return networks;
        }

        wifiManager.startScan();

        try {
            Thread.sleep(timeout);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        List<ScanResult> results = wifiManager.getScanResults();

        for (ScanResult result : results) {
            if (result.level >= minSignalLevel) {
                if (!includeHidden && result.SSID.isEmpty())
                    continue;

                JSONObject network = new JSONObject();
                network.put("ssid", result.SSID);
                network.put("bssid", result.BSSID);
                network.put("level", result.level);
                network.put("frequency", result.frequency);
                network.put("capabilities", result.capabilities);

                networks.put(network);
            }
        }

        return networks;
    }

    public void enableAutoReconnect(JSONObject config) {
        this.autoReconnectEnabled = true;
        this.autoReconnectConfig = config;
        // Setup reconnection logic
    }

    public void disableAutoReconnect() {
        this.autoReconnectEnabled = false;
        this.autoReconnectConfig = null;
    }

    public void shutdown() {
        disableAutoReconnect();
    }

    private String formatIpAddress(int ip) {
        return String.format("%d.%d.%d.%d",
                (ip & 0xff),
                (ip >> 8 & 0xff),
                (ip >> 16 & 0xff),
                (ip >> 24 & 0xff));
    }
}
