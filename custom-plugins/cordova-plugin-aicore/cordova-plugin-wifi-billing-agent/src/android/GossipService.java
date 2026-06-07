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

import com.wifibilling.agent.protocols.GossipNode;

import org.json.JSONException;
import org.json.JSONObject;

public class GossipService extends Service {

    private static final String CHANNEL_ID = "GossipService";
    private static final int NOTIFICATION_ID = 1001;

    private final IBinder binder = new LocalBinder();
    private GossipNode gossipNode;

    public class LocalBinder extends Binder {
        GossipService getService() {
            return GossipService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String configStr = intent != null ? intent.getStringExtra("config") : null;
        JSONObject config = new JSONObject();
        if (configStr != null) {
            try {
                config = new JSONObject(configStr);
            } catch (JSONException e) {
                e.printStackTrace();
            }
        }

        Notification notification = createServiceNotification("Gossip Sync Active");
        startForeground(NOTIFICATION_ID, notification);

        if (gossipNode == null) {
            gossipNode = new GossipNode(getApplicationContext(), config);
            gossipNode.start();
        }

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (gossipNode != null) {
            gossipNode.stop();
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        if (gossipNode != null) {
            gossipNode.stop();
        }
        stopForeground(true);
        stopSelf();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Gossip Service",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Maintains peer-to-peer billing sync");

            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification createServiceNotification(String content) {
        Intent notificationIntent = new Intent(this, org.apache.cordova.CordovaActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("WiFi Gossip Sync")
                .setContentText(content)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    public GossipNode getGossipNode() {
        return gossipNode;
    }
}
