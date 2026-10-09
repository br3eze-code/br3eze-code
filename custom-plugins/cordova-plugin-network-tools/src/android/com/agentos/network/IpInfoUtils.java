package com.agentos.network;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.DhcpInfo;
import android.net.Network;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.text.format.Formatter;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** Optional IP/network context adapter. Location enrichment is explicitly opt-in. */
public final class IpInfoUtils {
    private static final String TAG = "AgentOSNetworkTools->IpInfoUtils";
    private IpInfoUtils() {}

    public static void getIpInfo(CordovaInterface cordova, CallbackContext callbackContext, boolean includeLocation) {
        cordova.getThreadPool().execute(() -> {
            try {
                Context context = cordova.getActivity().getApplicationContext();
                ConnectivityManager connectivity = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
                WifiManager wifi = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
                if (connectivity == null || wifi == null) {
                    callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK,
                            new JSONArray().put(degradedInfo("NETWORK_MANAGERS_UNAVAILABLE"))));
                    return;
                }

                JSONArray array = new JSONArray();
                boolean added = false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Network active = connectivity.getActiveNetwork();
                    if (active != null) {
                        NetworkInfo info = connectivity.getNetworkInfo(active);
                        if (info != null && info.isConnected()) { array.put(buildInfo(context, wifi, includeLocation)); added = true; }
                    }
                } else {
                    NetworkInfo info = connectivity.getActiveNetworkInfo();
                    if (info != null && info.isConnected()) { array.put(buildInfo(context, wifi, includeLocation)); added = true; }
                }
                if (!added) array.put(buildInfo(context, wifi, includeLocation));
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, array));
            } catch (Exception e) {
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK,
                        new JSONArray().put(degradedInfo("IP_INFO_UNAVAILABLE"))));
            }
        });
    }

    private static JSONObject buildInfo(Context context, WifiManager wifiManager, boolean includeLocation) throws JSONException {
        WifiInfo wifiInfo = null;
        DhcpInfo dhcp = null;
        try { wifiInfo = wifiManager.getConnectionInfo(); } catch (SecurityException ignored) {}
        try { dhcp = wifiManager.getDhcpInfo(); } catch (SecurityException ignored) {}

        JSONObject item = new JSONObject();
        item.put("contractVersion", "1.0");
        item.put("supported", true);
        item.put("available", true);
        item.put("type", "wifi");
        item.put("signal", wifiInfo == null ? -1 : wifiInfo.getRssi());
        item.put("speed", wifiInfo == null ? "UNKNOWN" : wifiInfo.getLinkSpeed());
        item.put("ssid", wifiInfo == null ? "UNKNOWN" : value(wifiInfo.getSSID()));
        item.put("internalip", wifiInfo == null ? "UNKNOWN" : Formatter.formatIpAddress(wifiInfo.getIpAddress()));
        item.put("macaddress", wifiInfo == null ? "UNKNOWN" : value(wifiInfo.getMacAddress()));
        item.put("networkid", wifiInfo == null ? -1 : wifiInfo.getNetworkId());
        item.put("frequency", wifiInfo == null ? -1 : wifiInfo.getFrequency());
        item.put("bssid", wifiInfo == null ? "UNKNOWN" : value(wifiInfo.getBSSID()));
        item.put("timezone", TimeZone.getDefault().getID());
        item.put("dns1", dhcp == null ? "UNKNOWN" : Formatter.formatIpAddress(dhcp.dns1));
        item.put("dns2", dhcp == null ? "UNKNOWN" : Formatter.formatIpAddress(dhcp.dns2));
        item.put("locationRequested", includeLocation);
        if (includeLocation) addLocationBestEffort(item, context);
        else putLocationUnknown(item);
        return item;
    }

    private static JSONObject degradedInfo(String reason) throws JSONException {
        JSONObject item = new JSONObject();
        item.put("contractVersion", "1.0");
        item.put("supported", true);
        item.put("available", false);
        item.put("reason", reason);
        item.put("type", "unknown");
        item.put("locationRequested", false);
        putLocationUnknown(item);
        return item;
    }

    private static String value(String value) { return value == null || value.length() == 0 || "<unknown ssid>".equalsIgnoreCase(value) ? "UNKNOWN" : value; }

    private static void putLocationUnknown(JSONObject item) throws JSONException {
        item.put("latitude", -1);
        item.put("longitude", -1);
        item.put("city", "UNKNOWN");
        item.put("street", "UNKNOWN");
        item.put("country", "UNKNOWN");
        item.put("region", "UNKNOWN");
        item.put("zipcode", "UNKNOWN");
        item.put("state", "UNKNOWN");
    }

    private static void addLocationBestEffort(JSONObject item, Context context) throws JSONException {
        putLocationUnknown(item);
        if (!hasLocationPermission(context)) return;
        try {
            LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            if (manager == null) return;
            Location location = null;
            try { if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) location = manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER); } catch (SecurityException ignored) {}
            if (location == null) return;
            item.put("latitude", location.getLatitude());
            item.put("longitude", location.getLongitude());
            if (!Geocoder.isPresent()) return;
            try {
                Geocoder geocoder = new Geocoder(context, Locale.getDefault());
                List<Address> addresses = geocoder.getFromLocation(location.getLatitude(), location.getLongitude(), 1);
                if (addresses != null && !addresses.isEmpty()) {
                    Address address = addresses.get(0);
                    item.put("city", value(address.getLocality()));
                    item.put("street", value(address.getThoroughfare()));
                    item.put("country", value(address.getCountryName()));
                    item.put("region", value(address.getSubAdminArea()));
                    item.put("zipcode", value(address.getPostalCode()));
                    item.put("state", value(address.getAdminArea()));
                }
            } catch (IOException | IllegalArgumentException ignored) {
                Log.d(TAG, "Geocoder unavailable; returning network data only");
            }
        } catch (SecurityException ignored) {
            Log.d(TAG, "Location permission unavailable; returning network data only");
        }
    }

    private static boolean hasLocationPermission(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    public static boolean isNetworkAvailable(Context context) {
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) return manager.getActiveNetwork() != null;
        NetworkInfo info = manager.getActiveNetworkInfo();
        return info != null && info.isConnected();
    }
}
