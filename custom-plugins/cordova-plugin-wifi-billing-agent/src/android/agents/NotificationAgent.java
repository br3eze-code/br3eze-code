package com.wifibilling.agent.agents;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class NotificationAgent {

    private Context context;
    private CoreAgent coreAgent;
    private NotificationManager notificationManager;
    private Vibrator vibrator;

    private boolean subtlePrompts;
    private boolean soundEnabled;
    private boolean vibrationEnabled;

    private int notificationIdCounter = 2000;

    public NotificationAgent(Context context, CoreAgent coreAgent, JSONObject config) {
        this.context = context;
        this.coreAgent = coreAgent;
        this.notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        this.vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);

        this.subtlePrompts = config.optBoolean("subtlePrompts", true);
        this.soundEnabled = config.optBoolean("soundEnabled", true);
        this.vibrationEnabled = config.optBoolean("vibrationEnabled", true);

        createChannels();
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Critical alerts channel
            NotificationChannel criticalChannel = new NotificationChannel(
                    "wba_critical",
                    "Critical Billing Alerts",
                    NotificationManager.IMPORTANCE_HIGH);
            criticalChannel.setDescription("Urgent billing notifications");
            notificationManager.createNotificationChannel(criticalChannel);

            // Standard channel
            NotificationChannel standardChannel = new NotificationChannel(
                    "wba_standard",
                    "Billing Notifications",
                    NotificationManager.IMPORTANCE_DEFAULT);
            standardChannel.setDescription("Standard billing updates");
            notificationManager.createNotificationChannel(standardChannel);

            // Subtle channel
            NotificationChannel subtleChannel = new NotificationChannel(
                    "wba_subtle",
                    "Subtle Prompts",
                    NotificationManager.IMPORTANCE_LOW);
            subtleChannel.setDescription("Gentle reminders");
            notificationManager.createNotificationChannel(subtleChannel);
        }
    }

    public int sendNotification(JSONObject notification) throws JSONException {
        int id = notification.optInt("id", notificationIdCounter++);
        String title = notification.getString("title");
        String message = notification.getString("message");
        String priority = notification.optString("priority", "normal");

        String channelId = getChannelForPriority(priority);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(getPriorityValue(priority))
                .setAutoCancel(true);

        // Add actions if provided
        JSONArray actions = notification.optJSONArray("actions");
        if (actions != null) {
            for (int i = 0; i < actions.length(); i++) {
                JSONObject action = actions.getJSONObject(i);
                builder.addAction(
                        android.R.drawable.ic_menu_close_clear_cancel,
                        action.getString("title"),
                        createPendingIntent(action.getString("action"), id));
            }
        }

        // Set sound and vibration based on priority
        if (priority.equals("critical") || priority.equals("high")) {
            if (soundEnabled) {
                builder.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI);
            }
            if (vibrationEnabled && vibrator != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(500, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(500);
                }
            }
        }

        notificationManager.notify(id, builder.build());

        return id;
    }

    public void clearNotification(int id) {
        notificationManager.cancel(id);
    }

    public void clearAllNotifications() {
        notificationManager.cancelAll();
    }

    public void sendSubtlePrompt(JSONObject prompt) throws JSONException {
        if (!subtlePrompts)
            return;

        String title = prompt.optString("title", "WiFi Billing");
        String message = prompt.getString("message");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, "wba_subtle")
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setSilent(true);

        notificationManager.notify(notificationIdCounter++, builder.build());
    }

    private String getChannelForPriority(String priority) {
        switch (priority) {
            case "critical":
            case "high":
                return "wba_critical";
            case "low":
                return "wba_subtle";
            default:
                return "wba_standard";
        }
    }

    private int getPriorityValue(String priority) {
        switch (priority) {
            case "critical":
                return NotificationCompat.PRIORITY_MAX;
            case "high":
                return NotificationCompat.PRIORITY_HIGH;
            case "low":
                return NotificationCompat.PRIORITY_LOW;
            default:
                return NotificationCompat.PRIORITY_DEFAULT;
        }
    }

    private PendingIntent createPendingIntent(String action, int notificationId) {
        Intent intent = new Intent(context, NotificationActionReceiver.class);
        intent.setAction(action);
        intent.putExtra("notificationId", notificationId);

        return PendingIntent.getBroadcast(
                context,
                notificationId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public void shutdown() {
        clearAllNotifications();
    }
}
