package com.wifibilling.agent.agents;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.net.TrafficStats;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

public class BillingAgent {

    private static final String CHANNEL_ID = "WiFiBilling";
    private static final int NOTIFICATION_ID = 1001;

    private Context context;
    private CoreAgent coreAgent;
    private Handler mainHandler;
    private NotificationManager notificationManager;

    private Map<String, BillingSession> activeSessions = new HashMap<>();
    private Runnable billingRunnable;

    private String currency;
    private double defaultRate;
    private long billingInterval;

    public BillingAgent(Context context, CoreAgent coreAgent, JSONObject config) {
        this.context = context;
        this.coreAgent = coreAgent;
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        this.currency = config.optString("currency", "USD");
        this.defaultRate = config.optDouble("defaultRate", 0.10);
        this.billingInterval = config.optInt("billingInterval", 60000);

        createNotificationChannel();
    }

    public void initialize() {
        startBillingCycle();
    }

    public JSONObject startSession(String connectionId, String ssid, String userId,
            String planId, int timeLimit, long dataLimit) throws JSONException {

        String sessionId = "pc-sess-" + UUID.randomUUID().toString();

        BillingSession session = new BillingSession();
        session.id = sessionId;
        session.connectionId = connectionId;
        session.ssid = ssid;
        session.userId = userId;
        session.planId = planId;
        session.startTime = System.currentTimeMillis();
        session.timeLimit = timeLimit * 60 * 1000; // Convert to ms
        session.dataLimit = dataLimit;
        session.rate = defaultRate;
        session.state = "active";
        session.startBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();

        activeSessions.put(sessionId, session);

        // Show notification
        showSessionNotification(session);

        JSONObject result = new JSONObject();
        result.put("sessionId", sessionId);
        result.put("ssid", ssid);
        result.put("startTime", session.startTime);
        result.put("state", "active");
        result.put("currency", currency);
        result.put("rate", session.rate);

        return result;
    }

    public JSONObject endSession(String sessionId, String reason) throws JSONException {
        BillingSession session = activeSessions.get(sessionId);
        if (session == null) {
            throw new JSONException("Session not found: " + sessionId);
        }

        // Calculate final usage
        long currentBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();
        long dataUsed = currentBytes - session.startBytes;
        long duration = System.currentTimeMillis() - session.startTime;
        double cost = calculateCost(session, dataUsed, duration);

        session.endTime = System.currentTimeMillis();
        session.state = "ended";
        session.finalCost = cost;

        // Clear notification
        notificationManager.cancel(NOTIFICATION_ID);

        JSONObject result = new JSONObject();
        result.put("sessionId", sessionId);
        result.put("duration", duration / 1000 / 60); // minutes
        result.put("dataUsed", dataUsed);
        result.put("dataUsedMB", dataUsed / (1024 * 1024));
        result.put("finalCost", cost);
        result.put("currency", currency);
        result.put("reason", reason);

        activeSessions.remove(sessionId);

        return result;
    }

    public JSONObject getSessionStatus(String sessionId) throws JSONException {
        BillingSession session = activeSessions.get(sessionId);
        if (session == null) {
            JSONObject empty = new JSONObject();
            empty.put("active", false);
            return empty;
        }

        long currentBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();
        long dataUsed = currentBytes - session.startBytes;
        long elapsed = System.currentTimeMillis() - session.startTime;
        long remaining = session.timeLimit - elapsed;

        JSONObject status = new JSONObject();
        status.put("active", true);
        status.put("sessionId", sessionId);
        status.put("state", session.state);
        status.put("ssid", session.ssid);
        status.put("elapsedMinutes", elapsed / 1000 / 60);
        status.put("remainingMinutes", Math.max(0, remaining / 1000 / 60));
        status.put("dataUsed", dataUsed);
        status.put("dataUsedMB", dataUsed / (1024 * 1024));
        status.put("dataLimitMB", session.dataLimit / (1024 * 1024));
        status.put("currentCost", calculateCost(session, dataUsed, elapsed));
        status.put("totalCost", session.finalCost);
        status.put("currency", currency);

        return status;
    }

    public JSONObject pauseSession(String sessionId, String reason) throws JSONException {
        BillingSession session = activeSessions.get(sessionId);
        if (session == null)
            throw new JSONException("Session not found");

        session.state = "paused";
        session.pauseTime = System.currentTimeMillis();

        // Save current data usage
        long currentBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();
        session.dataUsedBeforePause = currentBytes - session.startBytes;

        JSONObject result = new JSONObject();
        result.put("sessionId", sessionId);
        result.put("state", "paused");
        result.put("reason", reason);
        result.put("pauseTime", session.pauseTime);

        return result;
    }

    public JSONObject resumeSession(String sessionId) throws JSONException {
        BillingSession session = activeSessions.get(sessionId);
        if (session == null)
            throw new JSONException("Session not found");

        long pausedDuration = System.currentTimeMillis() - session.pauseTime;
        session.totalPaused += pausedDuration;
        session.state = "active";

        // Reset byte counters
        session.startBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes()
                - session.dataUsedBeforePause;

        JSONObject result = new JSONObject();
        result.put("sessionId", sessionId);
        result.put("state", "active");
        result.put("pausedDuration", pausedDuration);

        return result;
    }

    public JSONObject getDataUsage(String sessionId) throws JSONException {
        BillingSession session = activeSessions.get(sessionId);
        if (session == null) {
            JSONObject empty = new JSONObject();
            empty.put("active", false);
            return empty;
        }

        long currentBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();
        long dataUsed = currentBytes - session.startBytes;

        JSONObject usage = new JSONObject();
        usage.put("active", true);
        usage.put("sessionDataUsed", dataUsed);
        usage.put("sessionDataUsedMB", dataUsed / (1024 * 1024));
        usage.put("dataLimitMB", session.dataLimit / (1024 * 1024));
        usage.put("percentageUsed", session.dataLimit > 0 ? (dataUsed * 100 / session.dataLimit) : 0);

        return usage;
    }

    private void startBillingCycle() {
        billingRunnable = new Runnable() {
            @Override
            public void run() {
                for (BillingSession session : activeSessions.values()) {
                    if ("active".equals(session.state)) {
                        try {
                            updateSession(session);
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                }
                mainHandler.postDelayed(this, billingInterval);
            }
        };
        mainHandler.postDelayed(billingRunnable, billingInterval);
    }

    private void updateSession(BillingSession session) throws JSONException {
        long currentBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();
        long dataUsed = currentBytes - session.startBytes;
        long elapsed = System.currentTimeMillis() - session.startTime - session.totalPaused;

        // Check time limit
        if (elapsed >= session.timeLimit) {
            // Trigger time limit event
            coreAgent.emitEvent("billing:time_limit_reached",
                    new JSONObject().put("sessionId", session.id));
        }

        // Check data limit
        if (session.dataLimit > 0 && dataUsed >= session.dataLimit) {
            coreAgent.emitEvent("billing:data_limit_reached",
                    new JSONObject().put("sessionId", session.id));
        }

        // Low time warning
        long remaining = session.timeLimit - elapsed;
        if (remaining < 5 * 60 * 1000 && remaining > 4 * 60 * 1000) { // 5 minute warning
            coreAgent.emitEvent("billing:time_low",
                    new JSONObject()
                            .put("sessionId", session.id)
                            .put("minutes", remaining / 1000 / 60));
        }

        // Update notification
        updateSessionNotification(session, elapsed, dataUsed);
    }

    private double calculateCost(BillingSession session, long dataUsed, long duration) {
        // Time-based billing
        double timeCost = (duration / 1000.0 / 60.0) * session.rate;

        // Could add data-based component here
        // double dataCost = (dataUsed / (1024.0 * 1024.0 * 1024.0)) * dataRate;

        return Math.round(timeCost * 100.0) / 100.0;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "WiFi Billing Session",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Active WiFi billing session");
            notificationManager.createNotificationChannel(channel);
        }
    }

    private void showSessionNotification(BillingSession session) {
        Notification notification = buildNotification("Session started",
                "Connected to " + session.ssid);
        notificationManager.notify(NOTIFICATION_ID, notification);
    }

    private void updateSessionNotification(BillingSession session, long elapsed, long dataUsed) {
        long remainingMinutes = Math.max(0, (session.timeLimit - elapsed) / 1000 / 60);
        double currentCost = calculateCost(session, dataUsed, elapsed);

        String content = String.format("Time: %d min remaining | Cost: $%.2f",
                remainingMinutes, currentCost);

        Notification notification = buildNotification("WiFi Billing Active", content);
        notificationManager.notify(NOTIFICATION_ID, notification);
    }

    private Notification buildNotification(String title, String content) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(content)
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW);

        return builder.build();
    }

    public void shutdown() {
        mainHandler.removeCallbacks(billingRunnable);
        notificationManager.cancel(NOTIFICATION_ID);
    }

    // Inner class for session tracking
    private static class BillingSession {
        String id;
        String connectionId;
        String ssid;
        String userId;
        String planId;
        long startTime;
        long endTime;
        long timeLimit;
        long dataLimit;
        long startBytes;
        long dataUsedBeforePause;
        long pauseTime;
        long totalPaused;
        double rate;
        double finalCost;
        String state; // active, paused, ended
    }
}
