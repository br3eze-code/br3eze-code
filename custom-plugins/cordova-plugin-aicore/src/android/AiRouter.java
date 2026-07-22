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
import com.google.mlkit.genai.common.FeatureStatus;

import com.google.mlkit.genai.prompt.Generation;
import com.google.mlkit.genai.prompt.GenerativeModelFutures;
// import com.google.mlkit.genai.prompt.java.GenerativeModelFutures; // Duplicate removed
import com.google.mlkit.genai.prompt.GenerateContentRequest;
import com.google.mlkit.genai.prompt.GenerateContentResponse;
// import com.google.mlkit.genai.prompt.FeatureStatus; // Duplicate removed

public class AiRouter {
    private static final String TAG = "AiRouter";

    private static GenerativeModelFutures generativeModelFutures = null;

    public static void route(Context ctx, JSONObject req, CallbackContext cb) {
        try {
            String task = req.getString("task"); // Assuming task is the prompt/text
            String scope = req.optString("scope", "guest");

            // Stubbed ScopePolicy
            // if (!ScopePolicy.allowed(task, scope)) {
            // cb.error("Scope denied");
            // return;
            // }

            // Initialize if needed
            if (generativeModelFutures == null) {
                generativeModelFutures = GenerativeModelFutures.from(Generation.INSTANCE.getClient(ctx));
            }

            // Check availability first
            ListenableFuture<Integer> statusFuture = generativeModelFutures.checkStatus();

            Futures.addCallback(statusFuture, new FutureCallback<Integer>() {
                @Override
                public void onSuccess(Integer status) {
                    if (status == FeatureStatus.AVAILABLE) {
                        // Nano available - generate on-device
                        generateOnNano(task, cb);
                    } else if (status == FeatureStatus.DOWNLOADABLE) {
                        // Could trigger download, but for now fallback
                        fallbackResponse("nano_downloadable", task, cb);
                    } else {
                        // Unavailable - fallback to local heuristics
                        fallbackResponse("unavailable", task, cb);
                    }
                }

                @Override
                public void onFailure(Throwable t) {
                    Log.e(TAG, "Availability check failed", t);
                    fallbackResponse("check_failed", task, cb);
                }
            }, MoreExecutors.directExecutor());

        } catch (Exception e) {
            Log.e(TAG, "Routing error", e);
            cb.error(e.getMessage());
        }
    }

    private static void generateOnNano(String prompt, CallbackContext cb) {
        try {
            GenerateContentRequest request = GenerateContentRequest.builder()
                    .addText(prompt)
                    .build();

            ListenableFuture<GenerateContentResponse> responseFuture = generativeModelFutures.generateContent(request);

            Futures.addCallback(responseFuture, new FutureCallback<GenerateContentResponse>() {
                @Override
                public void onSuccess(GenerateContentResponse response) {
                    String text = response.getText();
                    if (text != null && !text.isEmpty()) {
                        try {
                            JSONObject result = new JSONObject()
                                    .put("ok", true)
                                    .put("task", prompt)
                                    .put("source", "nano")
                                    .put("text", text)
                                    .put("confidence", 0.95);
                            cb.success(result);
                        } catch (JSONException je) {
                            cb.error("JSON error: " + je.getMessage());
                        }
                    } else {
                        cb.error("Empty response from Nano");
                    }
                }

                @Override
                public void onFailure(Throwable t) {
                    Log.e(TAG, "Nano generation failed", t);
                    fallbackResponse("nano_failed", prompt, cb);
                }
            }, MoreExecutors.directExecutor());

        } catch (Exception e) {
            Log.e(TAG, "Nano request error", e);
            fallbackResponse("nano_error", prompt, cb);
        }
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