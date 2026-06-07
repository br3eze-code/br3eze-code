package com.wifibilling.agent;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.ComponentName;
import android.os.IBinder;
import android.os.Build;
import android.os.Looper;
import android.os.RemoteException;
import android.util.Log;

import com.wifibilling.agent.agents.*;
import com.wifibilling.agent.oem.*;
import com.wifibilling.agent.protocols.*;
import com.wifibilling.agent.utils.*;
import com.wifibilling.agent.wifiwizard2.WifiWizard2Core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import android.content.pm.PackageManager;

public class WiFiBillingAgentPlugin extends CordovaPlugin {

    private static final String TAG = "WiFiBillingAgent";

    // WiFiWizard2 Action Constants (for 100% compatibility)
    private static final String ADD_NETWORK = "add";
    private static final String REMOVE_NETWORK = "remove";
    private static final String CONNECT_NETWORK = "connect";
    private static final String CONNECT = "connect"; // WiFiWizard2 style
    private static final String DISCONNECT_NETWORK = "disconnectNetwork";
    private static final String DISCONNECT = "disconnect";
    private static final String LIST_NETWORKS = "listNetworks";
    private static final String START_SCAN = "startScan";
    private static final String GET_SCAN_RESULTS = "getScanResults";
    private static final String GET_CONNECTED_SSID = "getConnectedSSID";
    private static final String GET_CONNECTED_BSSID = "getConnectedBSSID";
    private static final String GET_CONNECTED_NETWORKID = "getConnectedNetworkID";
    private static final String IS_WIFI_ENABLED = "isWifiEnabled";
    private static final String SET_WIFI_ENABLED = "setWifiEnabled";
    private static final String SCAN = "scan";
    private static final String ENABLE_NETWORK = "enable";
    private static final String DISABLE_NETWORK = "disable";
    private static final String GET_SSID_NET_ID = "getSSIDNetworkID";
    private static final String REASSOCIATE = "reassociate";
    private static final String RECONNECT = "reconnect";
    private static final String REQUEST_FINE_LOCATION = "requestFineLocation";
    private static final String GET_WIFI_IP_ADDRESS = "getWifiIP";
    private static final String GET_WIFI_ROUTER_IP_ADDRESS = "getWifiRouterIP";
    private static final String CAN_PING_WIFI_ROUTER = "canPingWifiRouter";
    private static final String CAN_CONNECT_TO_ROUTER = "canConnectToRouter";
    private static final String CAN_CONNECT_TO_INTERNET = "canConnectToInternet";
    private static final String IS_CONNECTED_TO_INTERNET = "isConnectedToInternet";
    private static final String GET_WIFI_IP_INFO = "getWifiIPInfo";
    private static final String IS_LOCATION_ENABLED = "isLocationEnabled";
    private static final String SWITCH_TO_LOCATION_SETTINGS = "switchToLocationSettings";
    private static final String SPECIFIER_NETWORK = "specifierConnection";
    private static final String SUGGEST_NETWORK = "suggestConnection";
    private static final String SET_BIND_ALL = "setBindAll";
    private static final String RESET_BIND_ALL = "resetBindAll";

    // Billing Agent Actions
    private static final String INITIALIZE = "initialize";
    private static final String START_BILLING_SESSION = "startBillingSession";
    private static final String GET_SESSION_STATUS = "getSessionStatus";
    private static final String PAUSE_SESSION = "pauseSession";
    private static final String RESUME_SESSION = "resumeSession";
    private static final String GET_DATA_USAGE = "getDataUsage";
    private static final String ENABLE_AUTO_RECONNECT = "enableAutoReconnect";
    private static final String DISABLE_AUTO_RECONNECT = "disableAutoReconnect";
    private static final String GET_GOSSIP_PEERS = "getGossipPeers";
    private static final String GOSSIP_BROADCAST = "gossipBroadcast";
    private static final String SYNC_BILLING_STATE = "syncBillingState";
    private static final String GET_SYSTEM_STATUS = "getSystemStatus";
    private static final String SHUTDOWN = "shutdown";

    // Permission codes
    private static final int SCAN_RESULTS_CODE = 0;
    private static final int SCAN_CODE = 1;
    private static final int LOCATION_REQUEST_CODE = 2;
    private static final int WIFI_SERVICE_INFO_CODE = 3;
    private static final String ACCESS_FINE_LOCATION = android.Manifest.permission.ACCESS_FINE_LOCATION;

    private Context context;
    private ExecutorService executor;
    private WifiWizard2Core wifiWizard2Core;
    private OEMWiFiAdapter currentAdapter;
    private Map<String, OEMWiFiAdapter> adapters;
    private String detectedOEM;

    // Pending actions waiting for location permission
    private final List<PendingAction> pendingActions = new ArrayList<>();

    /** Holds the state for a plugin call that is blocked on location permission. */
    private static class PendingAction {
        final String action;
        final JSONArray args;
        final CallbackContext callbackContext;

        PendingAction(String action, JSONArray args, CallbackContext callbackContext) {
            this.action = action;
            this.args = args;
            this.callbackContext = callbackContext;
        }
    }

    // Native agents
    private CoreAgent coreAgent;
    private WiFiAgent wifiAgent;
    private BillingAgent billingAgent;
    private AuthAgent authAgent;
    private NotificationAgent notificationAgent;

    // Protocols
    private GossipNode gossipNode;

    // Services
    private WiFiBillingService billingService;
    private GossipService gossipService;
    private SessionMonitorService sessionService;
    private boolean serviceBound = false;

    // State
    private boolean initialized = false;
    private JSONObject pluginConfig;

    @Override
    public void initialize(CordovaInterface cordova, CordovaWebView webView) {
        super.initialize(cordova, webView);
        this.context = cordova.getActivity().getApplicationContext();
        this.executor = Executors.newCachedThreadPool();
        this.wifiWizard2Core = new WifiWizard2Core(cordova, webView);
        this.adapters = new HashMap<>();

        // Initialize all OEM adapters
        initAdapters();
    }

    private void initAdapters() {
        // Register all OEM adapters
        adapters.put("hms", new HMSAdapter(context));
        adapters.put("xiaomi", new XiaomiAdapter(context));
        adapters.put("oppo", new OPPOAdapter(context));
        adapters.put("vivo", new VivoAdapter(context));
        adapters.put("samsung", new SamsungAdapter(context));
        adapters.put("standard", new StandardAdapter(context));

        // Auto-detect OEM
        detectedOEM = detectOEM();
        currentAdapter = adapters.get(detectedOEM);

        Log.d(TAG, "Initialized with OEM: " + detectedOEM);
    }

    /**
     * Detect device OEM
     */
    private String detectOEM() {
        String manufacturer = Build.MANUFACTURER.toLowerCase();
        String brand = Build.BRAND.toLowerCase();

        if (manufacturer.contains("huawei") || brand.contains("honor")) {
            // Check for HMS availability
            try {
                Class.forName("com.huawei.hms.api.HuaweiApiClient");
                return "hms";
            } catch (ClassNotFoundException e) {
                return "standard";
            }
        } else if (manufacturer.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco")) {
            return "xiaomi";
        } else if (manufacturer.contains("oppo") || brand.contains("realme") || brand.contains("oneplus")) {
            return "oppo";
        } else if (manufacturer.contains("vivo") || brand.contains("iqoo")) {
            return "vivo";
        } else if (manufacturer.contains("samsung")) {
            return "samsung";
        }

        return "standard";
    }

    /**
     * Returns true for actions that require ACCESS_FINE_LOCATION on Android 10+.
     */
    private boolean needsLocationPermission(String action) {
        switch (action) {
            case SCAN:
            case START_SCAN:
            case GET_SCAN_RESULTS:
            case GET_CONNECTED_SSID:
            case GET_CONNECTED_BSSID:
            case SPECIFIER_NETWORK:
            case SUGGEST_NETWORK:
            case CONNECT_NETWORK:
            case "connectNetwork":
            case "getConnectionInfo":
                return true;
            default:
                return false;
        }
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {

        // Gate location/WiFi sensitive actions behind runtime permission checks
        if (needsLocationPermission(action)) {
            if (Build.VERSION.SDK_INT >= 33) { // Android 13+ TIRAMISU
                String NEARBY_WIFI = "android.permission.NEARBY_WIFI_DEVICES";
                if (!cordova.hasPermission(NEARBY_WIFI)) {
                    synchronized (pendingActions) {
                        pendingActions.add(new PendingAction(action, args, callbackContext));
                    }
                    cordova.requestPermission(this, LOCATION_REQUEST_CODE, NEARBY_WIFI);
                    return true;
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (!cordova.hasPermission(ACCESS_FINE_LOCATION)) {
                    synchronized (pendingActions) {
                        pendingActions.add(new PendingAction(action, args, callbackContext));
                    }
                    cordova.requestPermission(this, LOCATION_REQUEST_CODE, ACCESS_FINE_LOCATION);
                    return true;
                }
            }
        }

        // Route to WiFiWizard2 core for WiFi operations
        if (isWiFiWizard2Action(action)) {
            return wifiWizard2Core.execute(action, args, callbackContext);
        }

        // Route to Billing Agent System
        switch (action) {
            case "detectOEM":
                JSONObject result = new JSONObject();
                result.put("oem", detectedOEM);
                result.put("manufacturer", Build.MANUFACTURER);
                result.put("brand", Build.BRAND);
                result.put("model", Build.MODEL);
                callbackContext.success(result);
                return true;
            case "initialize":
                initialize(args.getJSONObject(0), callbackContext);
                return true;
            case "connect":
                connect(args.getJSONObject(0), callbackContext);
                return true;
            case "disconnect":
                disconnect(args.getJSONObject(0), callbackContext);
                return true;
            case "getConnectionInfo":
                getConnectionInfo(callbackContext);
                return true;
            case "scan":
                scan(args.getJSONObject(0), callbackContext);
                return true;
            case "startBillingSession":
                startBillingSession(args.getJSONObject(0), callbackContext);
                return true;
            case "getSessionStatus":
                getSessionStatus(callbackContext);
                return true;
            case "pauseSession":
                pauseSession(args.getString(0), callbackContext);
                return true;
            case "resumeSession":
                resumeSession(callbackContext);
                return true;
            case "getDataUsage":
                getDataUsage(callbackContext);
                return true;
            case "enableAutoReconnect":
                enableAutoReconnect(args.getJSONObject(0), callbackContext);
                return true;
            case "disableAutoReconnect":
                disableAutoReconnect(callbackContext);
                return true;
            case "getGossipPeers":
                getGossipPeers(callbackContext);
                return true;
            case "gossipBroadcast":
                gossipBroadcast(args.getString(0), args.getJSONObject(1), callbackContext);
                return true;
            case "syncBillingState":
                syncBillingState(callbackContext);
                return true;
            case "processIntent":
                processIntent(args.getString(0), args.getJSONObject(1), callbackContext);
                return true;
            case "authenticate":
                authenticate(args.getJSONObject(0), callbackContext);
                return true;
            case "validateToken":
                validateToken(args.getString(0), callbackContext);
                return true;
            case "refreshToken":
                refreshToken(callbackContext);
                return true;
            case "sendNotification":
                sendNotification(args.getJSONObject(0), callbackContext);
                return true;
            case "clearNotification":
                clearNotification(args.getInt(0), callbackContext);
                return true;
            case "enableBackgroundMode":
                enableBackgroundMode(args.getJSONObject(0), callbackContext);
                return true;
            case "disableBackgroundMode":
                disableBackgroundMode(callbackContext);
                return true;
            case "getSystemStatus":
                getSystemStatus(callbackContext);
                return true;
            case "subscribeToEvent":
                subscribeToEvent(args.getString(0), callbackContext);
                return true;
            case "shutdown":
                shutdown(callbackContext);
                return true;
            default:
                return false;
        }
    }

    private boolean isWiFiWizard2Action(String action) {
        switch (action) {
            case ADD_NETWORK:
            case REMOVE_NETWORK:
            case CONNECT_NETWORK:
            case DISCONNECT_NETWORK:
            case DISCONNECT:
            case LIST_NETWORKS:
            case START_SCAN:
            case GET_SCAN_RESULTS:
            case GET_CONNECTED_SSID:
            case GET_CONNECTED_BSSID:
            case GET_CONNECTED_NETWORKID:
            case IS_WIFI_ENABLED:
            case SET_WIFI_ENABLED:
            case SCAN:
            case ENABLE_NETWORK:
            case DISABLE_NETWORK:
            case GET_SSID_NET_ID:
            case REASSOCIATE:
            case RECONNECT:
            case REQUEST_FINE_LOCATION:
            case GET_WIFI_IP_ADDRESS:
            case GET_WIFI_ROUTER_IP_ADDRESS:
            case CAN_PING_WIFI_ROUTER:
            case CAN_CONNECT_TO_ROUTER:
            case CAN_CONNECT_TO_INTERNET:
            case IS_CONNECTED_TO_INTERNET:
            case GET_WIFI_IP_INFO:
            case IS_LOCATION_ENABLED:
            case SWITCH_TO_LOCATION_SETTINGS:
            case SPECIFIER_NETWORK:
            case SUGGEST_NETWORK:
            case SET_BIND_ALL:
            case RESET_BIND_ALL:
                return true;
            default:
                return false;
        }
    }

    private void initialize(JSONObject config, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                this.pluginConfig = config != null ? config : new JSONObject();

                // Initialize WiFiWizard2 core
                wifiWizard2Core.initialize();

                // Initialize state manager
                StateManager.getInstance().initialize(context, config);

                // Initialize core agent
                coreAgent = new CoreAgent(context, config);
                coreAgent.initialize();

                // Initialize specialized agents
                wifiAgent = new WiFiAgent(context, coreAgent, config);
                billingAgent = new BillingAgent(context, coreAgent, config);
                authAgent = new AuthAgent(context, coreAgent, config);
                notificationAgent = new NotificationAgent(context, coreAgent, config);

                // Initialize gossip protocol if enabled
                if (config.optBoolean("gossipEnabled", true)) {
                    gossipNode = new GossipNode(context, config);
                    gossipNode.start();
                }

                // Start foreground services
                startServices(config);

                JSONObject result = new JSONObject();
                result.put("status", "initialized");
                result.put("platform", "android");
                result.put("apiLevel", android.os.Build.VERSION.SDK_INT);
                result.put("agentId", coreAgent.getAgentId());

                callbackContext.success(result);

            } catch (Exception e) {
                Log.e(TAG, "Initialization failed", e);
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void connect(JSONObject options, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                String ssid = options.getString("ssid");
                String password = options.optString("password", null);
                boolean isBillingNetwork = options.optBoolean("isBillingNetwork", false);

                JSONObject result = wifiAgent.connect(ssid, password, options);

                // If billing network, start billing session
                if (isBillingNetwork && result.getBoolean("success")) {
                    String userId = options.optString("userId", null);
                    String planId = options.optString("planId", null);

                    JSONObject session = billingAgent.startSession(
                            result.getString("connectionId"),
                            ssid,
                            userId,
                            planId,
                            options.optInt("timeLimit", 60),
                            options.optLong("dataLimit", 1024 * 1024 * 1024));

                    result.put("sessionId", session.getString("sessionId"));
                    result.put("billingActive", true);

                    // Start session monitoring service
                    startSessionMonitor(session);
                }

                callbackContext.success(result);

            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void disconnect(JSONObject options, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                boolean endSession = options.optBoolean("endSession", true);
                String reason = options.optString("reason", "user_request");

                // Get current connection
                JSONObject connection = wifiAgent.getConnectionInfo();

                JSONObject result = new JSONObject();

                if (connection.has("sessionId") && endSession) {
                    // End billing session
                    JSONObject sessionResult = billingAgent.endSession(
                            connection.getString("sessionId"),
                            reason);
                    result.put("sessionEnded", true);
                    result.put("sessionId", connection.getString("sessionId"));
                    result.put("finalCost", sessionResult.optDouble("finalCost", 0));
                }

                // Disconnect WiFi
                wifiAgent.disconnect();

                result.put("success", true);
                callbackContext.success(result);

            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void getConnectionInfo(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject info = wifiAgent.getConnectionInfo();

                // Add billing info if active
                if (info.has("sessionId")) {
                    JSONObject billingInfo = billingAgent.getSessionStatus(info.getString("sessionId"));
                    info.put("billing", billingInfo);
                }

                callbackContext.success(info);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void scan(JSONObject options, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONArray networks = wifiAgent.scan(
                        options.optInt("timeout", 10000),
                        options.optBoolean("includeHidden", false),
                        options.optInt("minSignalLevel", -80));

                callbackContext.success(networks);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void startBillingSession(JSONObject config, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                if (!initialized) {
                    callbackContext.error("Plugin not initialized");
                    return;
                }
                // Get current connection info from WiFiWizard2
                JSONObject connection = wifiWizard2Core.getConnectionInfo();
                if (!connection.optBoolean("connected", false)) {
                    callbackContext.error("Not connected to WiFi");
                    return;
                }

                String ssid = connection.optString("ssid");
                String connectionId = connection.optString("connectionId", "unknown");

                JSONObject session = billingAgent.startSession(
                        null, // connectionId - not connected yet
                        config.optString("ssid", "unknown"),
                        config.optString("userId", null),
                        config.optString("planId", null),
                        config.optInt("timeLimit", 60),
                        config.optLong("dataLimit", 1024 * 1024 * 1024));
                // Start monitoring service
                startSessionMonitor(session);

                callbackContext.success(session);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void getSessionStatus(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                if (!initialized || billingAgent == null) {
                    callbackContext.error("Billing not initialized");
                    return;
                }
                JSONObject connection = wifiAgent.getConnectionInfo();
                String sessionId = connection.optString("sessionId", null);
                if (sessionId == null) {
                    JSONObject empty = new JSONObject();
                    empty.put("active", false);
                    callbackContext.success(empty);
                    return;
                }

                JSONObject status = new JSONObject();

                if (connection.has("sessionId")) {
                    status = billingAgent.getSessionStatus(connection.getString("sessionId"));
                    status.put("active", true);
                } else {
                    status.put("active", false);
                }

                callbackContext.success(status);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void pauseSession(String reason, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject connection = wifiAgent.getConnectionInfo();
                if (!connection.has("sessionId")) {
                    callbackContext.error("No active session");
                    return;
                }

                JSONObject result = billingAgent.pauseSession(
                        connection.getString("sessionId"),
                        reason);

                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void resumeSession(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject connection = wifiAgent.getConnectionInfo();
                if (!connection.has("sessionId")) {
                    callbackContext.error("No active session");
                    return;
                }

                JSONObject result = billingAgent.resumeSession(connection.getString("sessionId"));
                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void getDataUsage(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject connection = wifiAgent.getConnectionInfo();
                JSONObject usage = new JSONObject();

                if (connection.has("sessionId")) {
                    usage = billingAgent.getDataUsage(connection.getString("sessionId"));
                } else {
                    usage.put("active", false);
                }

                callbackContext.success(usage);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void enableAutoReconnect(JSONObject config, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                wifiAgent.enableAutoReconnect(config);
                callbackContext.success(new JSONObject().put("enabled", true));
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void disableAutoReconnect(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                wifiAgent.disableAutoReconnect();
                callbackContext.success(new JSONObject().put("enabled", false));
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void getGossipPeers(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                if (gossipNode == null) {
                    callbackContext.error("Gossip protocol not enabled");
                    return;
                }

                JSONObject peers = gossipNode.getPeers();
                callbackContext.success(peers);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void gossipBroadcast(String type, JSONObject payload, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                if (gossipNode == null) {
                    callbackContext.error("Gossip protocol not enabled");
                    return;
                }

                String messageId = gossipNode.broadcast(type, payload);

                JSONObject result = new JSONObject();
                result.put("messageId", messageId);
                result.put("broadcasted", true);

                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void syncBillingState(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                if (gossipNode == null) {
                    callbackContext.error("Gossip protocol not enabled");
                    return;
                }

                // Get current billing state
                JSONObject connection = wifiAgent.getConnectionInfo();
                if (!connection.has("sessionId")) {
                    callbackContext.error("No active billing session");
                    return;
                }

                JSONObject session = billingAgent.getSessionStatus(connection.getString("sessionId"));

                // Broadcast to peers
                String messageId = gossipNode.broadcast("billing_sync", session);

                JSONObject result = new JSONObject();
                result.put("synced", true);
                result.put("messageId", messageId);
                result.put("peers", gossipNode.getPeerCount());

                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void processIntent(String input, JSONObject context, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                // Use AI orchestrator if available
                JSONObject result = coreAgent.processIntent(input, context);
                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void authenticate(JSONObject credentials, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject result = authAgent.authenticate(credentials);
                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void validateToken(String token, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject result = authAgent.validateToken(token);
                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void refreshToken(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject result = authAgent.refreshToken();
                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void sendNotification(JSONObject notification, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                int id = notificationAgent.sendNotification(notification);

                JSONObject result = new JSONObject();
                result.put("id", id);
                result.put("sent", true);

                callbackContext.success(result);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void clearNotification(int id, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                notificationAgent.clearNotification(id);
                callbackContext.success(new JSONObject().put("cleared", true));
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void enableBackgroundMode(JSONObject config, CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                Intent intent = new Intent(context, WiFiBillingService.class);
                intent.putExtra("config", config.toString());
                context.startForegroundService(intent);

                callbackContext.success(new JSONObject().put("enabled", true));
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void disableBackgroundMode(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                Intent intent = new Intent(context, WiFiBillingService.class);
                context.stopService(intent);

                callbackContext.success(new JSONObject().put("enabled", false));
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void getSystemStatus(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                JSONObject status = new JSONObject();

                status.put("platform", "android");
                status.put("agents", new JSONObject()
                        .put("core", coreAgent != null)
                        .put("wifi", wifiAgent != null)
                        .put("billing", billingAgent != null)
                        .put("auth", authAgent != null)
                        .put("notification", notificationAgent != null));

                status.put("gossip", gossipNode != null ? gossipNode.getStats() : JSONObject.NULL);
                status.put("connection", wifiAgent.getConnectionInfo());

                JSONObject session = new JSONObject();
                try {
                    JSONObject conn = wifiAgent.getConnectionInfo();
                    if (conn.has("sessionId")) {
                        session = billingAgent.getSessionStatus(conn.getString("sessionId"));
                    }
                } catch (Exception e) {
                    // No active session
                }
                status.put("session", session);

                callbackContext.success(status);
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void subscribeToEvent(String event, CallbackContext callbackContext) {
        // Register event listener
        coreAgent.registerEventListener(event, data -> {
            PluginResult result = new PluginResult(PluginResult.Status.OK, data);
            result.setKeepCallback(true);
            callbackContext.sendPluginResult(result);
        });
    }

    private void shutdown(CallbackContext callbackContext) {
        executor.execute(() -> {
            try {
                // Stop services
                stopServices();

                // Stop gossip
                if (gossipNode != null) {
                    gossipNode.stop();
                }

                // Shutdown agents
                if (billingAgent != null)
                    billingAgent.shutdown();
                if (wifiAgent != null)
                    wifiAgent.shutdown();
                if (authAgent != null)
                    authAgent.shutdown();
                if (notificationAgent != null)
                    notificationAgent.shutdown();
                if (coreAgent != null)
                    coreAgent.shutdown();

                callbackContext.success(new JSONObject().put("shutdown", true));
            } catch (Exception e) {
                callbackContext.error(e.getMessage());
            }
        });
    }

    private void startServices(JSONObject config) {
        // Start WiFi Billing Service
        Intent billingIntent = new Intent(context, WiFiBillingService.class);
        billingIntent.putExtra("config", config.toString());
        context.startForegroundService(billingIntent);

        // Start Gossip Service if enabled
        if (config.optBoolean("gossipEnabled", true)) {
            Intent gossipIntent = new Intent(context, GossipService.class);
            context.startService(gossipIntent);
        }
    }

    private void startSessionMonitor(JSONObject session) {
        Intent intent = new Intent(context, SessionMonitorService.class);
        intent.putExtra("session", session.toString());
        context.startForegroundService(intent);
    }

    private void stopServices() {
        context.stopService(new Intent(context, WiFiBillingService.class));
        context.stopService(new Intent(context, GossipService.class));
        context.stopService(new Intent(context, SessionMonitorService.class));
    }

    @Override
    public void onRequestPermissionResult(int requestCode, String[] permissions, int[] grantResults)
            throws JSONException {
        if (requestCode == LOCATION_REQUEST_CODE) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;

            List<PendingAction> snapshot;
            synchronized (pendingActions) {
                snapshot = new ArrayList<>(pendingActions);
                pendingActions.clear();
            }

            for (PendingAction pending : snapshot) {
                if (granted) {
                    // Replay the action now that permission is granted
                    try {
                        execute(pending.action, pending.args, pending.callbackContext);
                    } catch (JSONException e) {
                        pending.callbackContext.error(e.getMessage());
                    }
                } else {
                    pending.callbackContext.error("LOCATION_PERMISSION_DENIED");
                }
            }
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (executor != null) {
            executor.shutdown();
        }
        stopServices();
    }
}
