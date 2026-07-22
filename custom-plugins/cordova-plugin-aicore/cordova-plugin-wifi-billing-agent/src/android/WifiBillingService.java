package com.wifibilling.agent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

public class WiFiBillingService extends Service {

    private static final String CHANNEL_ID = "WiFiBillingService";
    private static final int NOTIFICATION_ID = 1000;

    private final IBinder binder = new LocalBinder();

    public class LocalBinder extends Binder {
        WiFiBillingService getService() {
            return WiFiBillingService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String config = intent != null ? intent.getStringExtra("config") : null;

        Notification notification = createServiceNotification("WiFi Billing Agent Active");
        if (Build.VERSION.SDK_INT >= 29) { // Build.VERSION_CODES.Q
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Initialize service components
        initializeComponents(config);

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        cleanup();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        cleanup();
        stopForeground(true);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "WiFi Billing Service",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Maintains WiFi billing session");

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification createServiceNotification(String content) {
        Intent notificationIntent = new Intent(this, org.apache.cordova.CordovaActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Power Connect WiFi")
                .setContentText(content)
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    private void initializeComponents(String config) {
        // Initialize native components that need to run in background
    }

    private void cleanup() {
        // Cleanup resources
    }

    public void updateNotification(String content) {
        Notification notification = createServiceNotification(content);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, notification);
    }
}
