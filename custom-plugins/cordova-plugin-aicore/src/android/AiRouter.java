package zw.power.www;

import android.content.Context;
import android.net.TrafficStats;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.json.JSONException;
import org.json.JSONObject;

/** Safe router for the AI plugin. No network or model fallback is performed here. */
public final class AiRouter {
    private static final String TAG = "AiRouter";

    private AiRouter() { }

    public static void route(Context ctx, JSONObject req, CallbackContext cb) {
        try {
            if (req == null || !req.has("task")) {
                cb.error("INVALID_REQUEST: task is required");
                return;
            }
            String task = req.optString("task", "").trim();
            if (task.isEmpty()) {
                cb.error("INVALID_REQUEST: task must not be empty");
                return;
            }

            // Intentionally do not silently route to a cloud model. The host AgentOS
            // gateway owns authenticated model selection and policy enforcement.
            cb.error("AI_MODEL_UNAVAILABLE: no verified on-device model is enabled");
        } catch (Exception e) {
            Log.e(TAG, "Routing error", e);
            cb.error("ROUTING_FAILED: " + e.getMessage());
        }
    }

    public static long getAppBytes(int uid) {
        long rx = TrafficStats.getUidRxBytes(uid);
        long tx = TrafficStats.getUidTxBytes(uid);
        return Math.max(0L, rx) + Math.max(0L, tx);
    }
}
