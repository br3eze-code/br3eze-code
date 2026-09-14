package cordova.plugins.backgroundmodern;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class BackgroundPlugin extends CordovaPlugin {
    private boolean activityVisible = false;
    private boolean serviceRequested = false;

    @Override
    protected void pluginInitialize() {
        super.pluginInitialize();
        Activity activity = cordova.getActivity();
        activityVisible = activity != null && !activity.isFinishing();
    }

    @Override
    public void onResume(boolean multitasking) {
        activityVisible = true;
        super.onResume(multitasking);
    }

    @Override
    public void onPause(boolean multitasking) {
        activityVisible = false;
        super.onPause(multitasking);
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "start": start(callbackContext); return true;
            case "stop": stop(callbackContext); return true;
            case "status": status(callbackContext); return true;
            default: return false;
        }
    }

    private void start(CallbackContext callbackContext) {
        if (!activityVisible) {
            callbackContext.error(error("BACKGROUND_START_NOT_ALLOWED", "Start must be requested while the Cordova activity is visible."));
            return;
        }

        cordova.getThreadPool().execute(() -> {
            try {
                Context context = cordova.getContext();
                Intent intent = new Intent(context, BackgroundService.class);
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
                else context.startService(intent);
                serviceRequested = true;
                callbackContext.success(statusJson(true));
            } catch (RuntimeException error) {
                serviceRequested = false;
                callbackContext.error(error("FOREGROUND_SERVICE_START_FAILED", error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage())));
            }
        });
    }

    private void stop(CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            boolean stopped = cordova.getContext().stopService(new Intent(cordova.getContext(), BackgroundService.class));
            serviceRequested = false;
            callbackContext.success(statusJson(false, stopped));
        });
    }

    private void status(CallbackContext callbackContext) {
        callbackContext.success(statusJson(serviceRequested));
    }

    private JSONObject statusJson(boolean active) { return statusJson(active, null); }

    private JSONObject statusJson(boolean active, Boolean stopped) {
        JSONObject result = new JSONObject();
        try {
            result.put("active", active);
            result.put("activityVisible", activityVisible);
            if (stopped != null) result.put("stopped", stopped);
        } catch (JSONException ignored) { }
        return result;
    }

    private JSONObject error(String code, String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("code", code);
            result.put("message", message);
            result.put("activityVisible", activityVisible);
        } catch (JSONException ignored) { }
        return result;
    }
}
