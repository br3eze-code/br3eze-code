package com.agentos.network;

import android.content.Context;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.text.format.Formatter;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Wi-Fi telemetry and LAN discovery adapter. */
public final class WifiUtils {
    private WifiUtils() {}

    public static void getSignalStrength(Context context, CallbackContext callbackContext) {
        try {
            WifiManager manager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo info = manager == null ? null : manager.getConnectionInfo();
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, info == null ? -1 : info.getRssi()));
        } catch (Exception e) {
            callbackContext.error("Error getting signal strength: " + e.getMessage());
        }
    }

    public static void getWifiStrength(Context context, CallbackContext callbackContext) {
        try {
            WifiManager manager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiInfo info = manager == null ? null : manager.getConnectionInfo();
            int strength = info == null ? 0 : WifiManager.calculateSignalLevel(info.getRssi(), 5);
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, strength));
        } catch (Exception e) {
            callbackContext.error("Error getting WiFi strength: " + e.getMessage());
        }
    }

    public static void getWifiList(CordovaInterface cordova, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                WifiManager manager = (WifiManager) cordova.getActivity().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (manager == null) { callbackContext.error("WifiManager not available"); return; }
                if (!manager.isWifiEnabled()) { callbackContext.error("Wi-Fi is disabled"); return; }
                try { manager.startScan(); } catch (SecurityException ignored) {}
                List<ScanResult> scans = manager.getScanResults();
                Collections.sort(scans, Comparator.comparingInt((ScanResult r) -> r.level).reversed());
                JSONArray result = new JSONArray();
                for (ScanResult scan : scans) {
                    JSONObject item = new JSONObject();
                    item.put("SSID", scan.SSID);
                    item.put("BSSID", scan.BSSID);
                    item.put("capabilities", scan.capabilities);
                    item.put("frequency", scan.frequency / 1000.0 + " GHz");
                    item.put("security", getSecurityType(scan.capabilities));
                    item.put("level", scan.level);
                    item.put("channelWidth", channelWidth(scan));
                    item.put("distance", calculateDistance(scan.level, scan.frequency));
                    item.put("hasPassword", hasPassword(scan.capabilities));
                    result.put(item);
                }
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, result));
            } catch (Exception e) {
                callbackContext.error("Error scanning Wi-Fi: " + e.getMessage());
            }
        });
    }

    public static void getConnectedDevices(Context context, CordovaInterface cordova, CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            ExecutorService executor = null;
            try {
                WifiManager manager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                WifiInfo info = manager == null ? null : manager.getConnectionInfo();
                if (info == null) { callbackContext.error("Wi-Fi connection unavailable"); return; }
                String ipAddress = Formatter.formatIpAddress(info.getIpAddress());
                int dot = ipAddress.lastIndexOf('.');
                if (dot < 0) { callbackContext.error("Unable to determine local subnet"); return; }
                String subnet = ipAddress.substring(0, dot);
                JSONArray devices = new JSONArray();
                executor = Executors.newFixedThreadPool(20);
                CountDownLatch latch = new CountDownLatch(255);
                final JSONArray synchronizedDevices = devices;
                for (int host = 1; host <= 255; host++) {
                    final int currentHost = host;
                    executor.submit(() -> {
                        try {
                            String candidate = subnet + "." + currentHost;
                            if (InetAddress.getByName(candidate).isReachable(150)) {
                                JSONObject device = new JSONObject();
                                device.put("ipAddress", candidate);
                                device.put("deviceName", getDeviceNameByIp(candidate));
                                device.put("localHost", isLocalHost(candidate));
                                device.put("loopbackAddress", isLoopbackAddress(candidate));
                                device.put("hostAddress", getHostAddress(candidate));
                                device.put("canonicalHostName", getCanonicalHostName(candidate));
                                device.put("multicastAddress", isMulticastAddress(candidate));
                                device.put("siteLocalAddress", isSiteLocalAddress(candidate));
                                synchronized (synchronizedDevices) { synchronizedDevices.put(device); }
                            }
                        } catch (Exception ignored) {
                        } finally { latch.countDown(); }
                    });
                }
                latch.await();
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, devices));
            } catch (Exception e) {
                callbackContext.error("Error getting connected devices: " + e.getMessage());
            } finally { if (executor != null) executor.shutdownNow(); }
        });
    }

    private static boolean hasPassword(String capabilities) {
        return capabilities != null && (capabilities.contains("WEP") || capabilities.contains("WPA") || capabilities.contains("PSK"));
    }
    private static String getSecurityType(String capabilities) {
        if (capabilities == null) return "Open";
        if (capabilities.contains("WPA3")) return "WPA3";
        if (capabilities.contains("WPA2")) return "WPA2";
        if (capabilities.contains("WPA")) return "WPA";
        if (capabilities.contains("WEP")) return "WEP";
        return "Open";
    }
    private static String channelWidth(ScanResult scan) {
        switch (scan.channelWidth) {
            case ScanResult.CHANNEL_WIDTH_20MHZ: return "20 MHz";
            case ScanResult.CHANNEL_WIDTH_40MHZ: return "40 MHz";
            case ScanResult.CHANNEL_WIDTH_80MHZ: return "80 MHz";
            case ScanResult.CHANNEL_WIDTH_160MHZ: return "160 MHz";
            default: return "Unknown";
        }
    }
    private static String calculateDistance(double dbm, double freqMHz) {
        if (freqMHz <= 0) return "UNKNOWN";
        double exp = (27.55 - (20 * Math.log10(freqMHz)) + Math.abs(dbm)) / 20.0;
        return String.format(java.util.Locale.US, "%.2f", Math.pow(10.0, exp));
    }
    private static String getDeviceNameByIp(String ip) { try { return InetAddress.getByName(ip).getHostName(); } catch (Exception e) { return "Unknown"; } }
    private static boolean isLocalHost(String ip) { return InetAddress.getLoopbackAddress().getHostAddress().equals(ip); }
    private static boolean isLoopbackAddress(String ip) { try { return InetAddress.getByName(ip).isLoopbackAddress(); } catch (Exception e) { return false; } }
    private static String getHostAddress(String ip) { try { return InetAddress.getByName(ip).getHostAddress(); } catch (Exception e) { return "Unknown"; } }
    private static String getCanonicalHostName(String ip) { try { return InetAddress.getByName(ip).getCanonicalHostName(); } catch (Exception e) { return "Unknown"; } }
    private static boolean isMulticastAddress(String ip) { try { return InetAddress.getByName(ip).isMulticastAddress(); } catch (Exception e) { return false; } }
    private static boolean isSiteLocalAddress(String ip) { try { return InetAddress.getByName(ip).isSiteLocalAddress(); } catch (Exception e) { return false; } }
}
