package zw.power.www;

import android.content.Context;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.json.JSONException;
import org.json.JSONObject;

import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.common.util.concurrent.MoreExecutors;

import android.net.TrafficStats;

public class AiRouter {
    private static final String TAG = "AiRouter";

    public static void route(Context ctx, JSONObject req, CallbackContext cb) {
        try {
            String task = req.getString("task"); // Assuming task is the prompt/text
            fallbackResponse("unavailable", task, cb);
        } catch (Exception e) {
            Log.e(TAG, "Routing error", e);
            cb.error(e.getMessage());
        }
    }

    private static void generateOnNano(String prompt, CallbackContext cb) {
        fallbackResponse("nano_unavailable", prompt, cb);
    }

    // Returns total bytes (Received + Transmitted) for this app since phone boot
    public long getAppBytes(int uid) {
        return TrafficStats.getUidRxBytes(uid) + TrafficStats.getUidTxBytes(uid);
    }

    private static void fallbackResponse(String source, String task, CallbackContext cb) {
        // Heuristic or mock response (replace with real local ML if available)
        try {
            JSONObject result = new JSONObject()
                    .put("ok", true)
                    .put("task", task)
                    .put("source", source)
                    .put("text", heuristicResponse(task))
                    .put("confidence", 0.7);
            cb.success(result);
        } catch (JSONException je) {
            cb.error("Fallback JSON error");
        }
    }

    private static String heuristicResponse(String prompt) {
        String lower = prompt.toLowerCase();
        if (lower.contains("revenue") || lower.contains("financial")) {
            return "Financial Analysis: Manual verification required.";
        }
        // Add more from your JS heuristics
        return "Offline response based on heuristics.";
    }
}