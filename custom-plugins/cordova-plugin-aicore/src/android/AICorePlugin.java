package zw.power.www;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.Log;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import com.google.android.gms.tasks.Task;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.pose.Pose;
import com.google.mlkit.vision.pose.PoseDetection;
import com.google.mlkit.vision.pose.PoseDetector;
import com.google.mlkit.vision.pose.PoseLandmark;
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions;

/**
 * Safe AI capability bridge.
 *
 * The previous implementation referenced unstable/placeholder GenAI Java APIs.
 * This implementation keeps the stable Pose Detection capability and reports
 * on-device text generation as unsupported until a pinned, verified SDK is added.
 */
public final class AICorePlugin extends CordovaPlugin {
    private static final String TAG = "AICorePlugin";
    private PoseDetector poseDetector;

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) throws JSONException {
        switch (action) {
            case "checkAvailability":
                JSONObject status = new JSONObject();
                status.put("textGeneration", false);
                status.put("poseDetection", true);
                status.put("code", "OPTIONAL_CAPABILITY_UNAVAILABLE");
                callbackContext.success(status);
                return true;
            case "capabilities":
                callbackContext.success(capabilities());
                return true;
            case "generateText":
            case "request":
                callbackContext.error("On-device text generation is not enabled in this build");
                return true;
            case "detectPose":
                if (args.length() < 1 || args.isNull(0)) {
                    callbackContext.error("INVALID_ARGUMENT: base64Image is required");
                    return true;
                }
                detectPose(args.getString(0), callbackContext);
                return true;
            default:
                callbackContext.error("UNKNOWN_ACTION: " + action);
                return false;
        }
    }

    private JSONObject capabilities() throws JSONException {
        return new JSONObject()
                .put("supported", true)
                .put("textGeneration", false)
                .put("poseDetection", true)
                .put("cloudFallback", false)
                .put("safeDegradation", true);
    }

    private void detectPose(final String base64Image, final CallbackContext callbackContext) {
        cordova.getThreadPool().execute(() -> {
            try {
                byte[] bytes = Base64.decode(base64Image, Base64.DEFAULT);
                Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bitmap == null) {
                    callbackContext.error("INVALID_IMAGE");
                    return;
                }

                if (poseDetector == null) {
                    PoseDetectorOptions options = new PoseDetectorOptions.Builder()
                            .setDetectorMode(PoseDetectorOptions.SINGLE_IMAGE_MODE)
                            .build();
                    poseDetector = PoseDetection.getClient(options);
                }

                InputImage image = InputImage.fromBitmap(bitmap, 0);
                Task<Pose> task = poseDetector.process(image);
                task.addOnSuccessListener(pose -> {
                    try {
                        JSONArray results = new JSONArray();
                        for (PoseLandmark landmark : pose.getAllPoseLandmarks()) {
                            JSONObject item = new JSONObject();
                            item.put("type", landmark.getLandmarkType());
                            item.put("x", landmark.getPosition().x);
                            item.put("y", landmark.getPosition().y);
                            item.put("likelihood", landmark.getInFrameLikelihood());
                            results.put(item);
                        }
                        callbackContext.success(results);
                    } catch (JSONException e) {
                        callbackContext.error("JSON_ERROR: " + e.getMessage());
                    }
                }).addOnFailureListener(error -> {
                    Log.e(TAG, "Pose detection failed", error);
                    callbackContext.error("POSE_DETECTION_FAILED: " + error.getMessage());
                });
            } catch (IllegalArgumentException e) {
                callbackContext.error("INVALID_BASE64_IMAGE");
            } catch (Exception e) {
                Log.e(TAG, "Pose detection fatal error", e);
                callbackContext.error("DETECTION_FAILED: " + e.getMessage());
            }
        });
    }

    @Override
    public void onDestroy() {
        if (poseDetector != null) {
            poseDetector.close();
            poseDetector = null;
        }
        super.onDestroy();
    }
}
