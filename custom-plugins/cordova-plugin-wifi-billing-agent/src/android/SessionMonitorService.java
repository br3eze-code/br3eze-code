package com.wifibilling.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.net.TrafficStats;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

import org.json.JSONException;
import org.json.JSONObject;

public class SessionMonitorService extends Service {

    private static final String CHANNEL_ID = "SessionMonitor";
    private static final int NOTIFICATION_ID = 1002;

    private Handler handler;
    private Runnable monitorRunnable;

    private String sessionId;
    private String ssid;
    private long startTime;
    private long timeLimit;
    private long dataLimit;
    private long startBytes;
    private double rate;

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String sessionJson = intent.getStringExtra("session");

        try {
            JSONObject session = new JSONObject(sessionJson);
            parseSession(session);
        } catch (JSONException e) {
            e.printStackTrace();
            stopSelf();
            return START_NOT_STICKY;
        }

        createNotificationChannel();
        startForeground(NOTIFICATION_ID, createNotification());
        startMonitoring();

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopMonitoring();
    }

    private void parseSession(JSONObject session) throws JSONException {
        this.sessionId = session.getString("sessionId");
        this.ssid = session.getString("ssid");
        this.startTime = session.getLong("startTime");
        this.timeLimit = session.optLong("timeLimit", 60 * 60 * 1000);
        this.dataLimit = session.optLong("dataLimit", 1024 * 1024 * 1024);
        this.rate = session.optDouble("rate", 0.10);
        this.startBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();
    }

    private void startMonitoring() {
        monitorRunnable = new Runnable() {
            @Override
            public void run() {
                updateSessionStats();
                handler.postDelayed(this, 30000); // Update every 30 seconds
            }
        };
        handler.post(monitorRunnable);
    }

    private void stopMonitoring() {
        handler.removeCallbacks(monitorRunnable);
    }

    private void updateSessionStats() {
        long currentBytes = TrafficStats.getTotalRxBytes() + TrafficStats.getTotalTxBytes();
        long dataUsed = currentBytes - startBytes;
        long elapsed = System.currentTimeMillis() - startTime;
        long remaining = timeLimit - elapsed;

        // Update notification
        updateNotification(dataUsed, remaining);

        // Check limits
        if (remaining <= 0) {
            // Time limit reached
            sendBroadcast(new Intent("com.wifibilling.TIME_LIMIT_REACHED")
                    .putExtra("sessionId", sessionId));
        }

        if (dataLimit > 0 && dataUsed >= dataLimit) {
            // Data limit reached
            sendBroadcast(new Intent("com.wifibilling.DATA_LIMIT_REACHED")
                    .putExtra("sessionId", sessionId));
        }

        // Low time warning
        if (remaining > 0 && remaining < 5 * 60 * 1000 && remaining > 4 * 60 * 1000) {
            sendBroadcast(new Intent("com.wifibilling.TIME_LOW")
                    .putExtra("sessionId", sessionId)
                    .putExtra("minutes", remaining / 1000 / 60));
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Session Monitor",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Monitors active WiFi billing session");

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification createNotification() {
        Intent intent = new Intent(this, org.apache.cordova.CordovaActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("WiFi Session Active")
                .setContentText("Monitoring connection to " + ssid)
                .setSmallIcon(android.R.drawable.ic_menu_recent_history)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(long dataUsed, long remaining) {
        double cost = (elapsedMinutes() * rate);
        long remainingMinutes = remaining / 1000 / 60;
        double dataUsedMB = dataUsed / (1024.0 * 1024.0);

        String content = String.format("Time: %d min | Data: %.1f MB | Cost: $%.2f",
                remainingMinutes, dataUsedMB, cost);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("WiFi Billing: " + ssid)
                .setContentText(content)
                .setSmallIcon(android.R.drawable.ic_menu_recent_history)
                .setOngoing(true)
                .build();

        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, notification);
    }

    private long elapsedMinutes() {
        return (System.currentTimeMillis() - startTime) / 1000 / 60;
    }
}
