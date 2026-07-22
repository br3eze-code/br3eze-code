package com.wifibilling.agent;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d(TAG, "Device boot completed, starting WiFi Billing Agent");

            // Start main billing service in foreground
            Intent billingIntent = new Intent(context, WiFiBillingService.class);
            context.startForegroundService(billingIntent);

            // GossipService will be started by main service if enabled
        }
    }
}
