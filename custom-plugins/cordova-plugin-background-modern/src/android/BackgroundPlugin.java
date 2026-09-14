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
    private volatile boolean activityVisible = false;
    private volatile boolean enabled = false;

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
    public void onReset() {
        // Do not kill the service merely because the WebView navigates/reloads.
        super.onReset();
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "start":
            case "enable":
                start(callbackContext);
                return true;
            case "stop":
            case "disable":
                stop(callbackContext);
                return true;
            case "status":
            case "isActive":
            case "isEnabled":
                status(callbackContext);
                return true;
            case "setEnabled":
                boolean value = args != null && args.length() > 0 && args.optBoolean(0, false);
                if (value) {
                    start(callbackContext);
                } else {
                    stop(callbackContext);
                }
                return true;
            default:
                callbackContext.error(error("UNKNOWN_ACTION", "Unsupported background action: " + action));
                return true;
        }
    }

    private void start(CallbackContext callbackContext) {
        if (!activityVisible) {
            callbackContext.error(error(
                    "BACKGROUND_START_NOT_ALLOWED",
                    "Start must be requested while the Cordova activity is visible."
            ));
            return;
        }

        enabled = true;
        cordova.getThreadPool().execute(() -> {
            try {
                Context context = cordova.getContext();
                Intent intent = new Intent(context, BackgroundService.class);
                if (Build.VERSION.SDK_INT >= 26) {
                    context.startForegroundService(intent);
                } else {
                    context.startService(intent);
                }
                callbackContext.success(statusJson(BackgroundService.isRunning()));
            } catch (RuntimeException error) {
                enabled = false;
                callbackContext.error(error(
                        "FOREGROUND_SERVICE_START_FAILED",
                        error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage())
                ));
            }
        });
    }

    private void stop(CallbackContext callbackContext) {
        enabled = false;
        cordova.getThreadPool().execute(() -> {
            boolean stopped = cordova.getContext().stopService(
                    new Intent(cordova.getContext(), BackgroundService.class)
            );
            callbackContext.success(statusJson(false, stopped));
        });
    }

    private void status(CallbackContext callbackContext) {
        callbackContext.success(statusJson(BackgroundService.isRunning()));
    }

    private JSONObject statusJson(boolean active) {
        return statusJson(active, null);
    }

    private JSONObject statusJson(boolean active, Boolean stopped) {
        JSONObject result = new JSONObject();
        try {
            result.put("active", active);
            result.put("enabled", enabled);
            result.put("activityVisible", activityVisible);
            result.put("platform", "android");
            if (stopped != null) result.put("stopped", stopped);
        } catch (JSONException ignored) {
        }
        return result;
    }

    private JSONObject error(String code, String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("code", code);
            result.put("message", message);
            result.put("enabled", enabled);
            result.put("activityVisible", activityVisible);
            result.put("platform", "android");
        } catch (JSONException ignored) {
        }
        return result;
    }
}
